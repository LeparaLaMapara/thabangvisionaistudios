export const dynamic = 'force-dynamic';

import crypto from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { rolesOffResponse } from '@/lib/roles/flag';
import { checkRateLimit } from '@/lib/auth';
import { RENTAL_CATEGORIES, ROLES_POLICY } from '@/lib/constants';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { getRoles, ROLE_DOCUMENT_BUCKET } from '@/lib/supabase/queries/roles';
import { cleanMatchText, EMPTY_FACTS, keywordMatch, matchCandidates, sanitizeFacts, type ProfileFacts } from '@/lib/roles';
import { suggestRoles } from '@/lib/roles/match-ai';
import { extractFacts } from '@/lib/roles/extract-ai';

/**
 * Screen 2, "Show us your work": one box takes anything.
 *
 *   POST { action: 'upload', kind: 'cv' | 'audio' | 'legal', ext }
 *        -> { bucket, path, token }: a one-time link into the PRIVATE bucket
 *        (a CV, a voice note or a Listen clip before we know the role, a legal photo).
 *   POST { action: 'analyze', text?, photo?, files?: [{ path, kind: 'cv' | 'audio', mime }] }
 *        -> { suggestions, facts }: the role suggestion (agent role-match)
 *        and the facts read from a CV, a voice note or the text (agent
 *        profile-extract), PII stripped. The person reviews the facts next.
 *
 * Nothing personal is logged. The private originals are deleted after
 * ROLES_POLICY.cvRetentionDays (delete_after on the evidence row).
 */

const EXT = /^(pdf|docx?|jpe?g|png|webp|heic|m4a|mp3|aac|wav|ogg|webm|mp4)$/i;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_CHARS = 1_400_000;

function mergeFacts(a: ProfileFacts, b: ProfileFacts): ProfileFacts {
  return sanitizeFacts({
    ...a,
    ...Object.fromEntries(
      (['roles', 'skills', 'job_kinds', 'areas', 'languages', 'equipment', 'vehicles', 'certifications'] as const).map((k) => [k, [...a[k], ...b[k]]]),
    ),
    years_experience: a.years_experience ?? b.years_experience,
    credits: [...a.credits, ...b.credits],
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const off = await rolesOffResponse();
  if (off) return off;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }

  const admin = createAdminClient();

  if (body.action === 'upload') {
    if (!(await checkRateLimit(`roles-intake-upload:${user.id}`, 20, 60_000))) {
      return NextResponse.json({ error: 'Too many uploads. Wait a moment.' }, { status: 429 });
    }
    const kind = body.kind === 'cv' || body.kind === 'audio' || body.kind === 'legal' ? body.kind : null;
    const ext = typeof body.ext === 'string' ? body.ext.replace(/^\./, '') : '';
    if (!kind || !EXT.test(ext)) return NextResponse.json({ error: 'That kind of file is not supported.' }, { status: 400 });
    const path = `${user.id}/intake/${kind}-${crypto.randomUUID()}.${ext.toLowerCase()}`;
    const { data, error } = await admin.storage.from(ROLE_DOCUMENT_BUCKET).createSignedUploadUrl(path);
    if (error || !data?.token) return NextResponse.json({ error: 'Could not prepare the upload. Please try again.' }, { status: 500 });
    return NextResponse.json({ bucket: ROLE_DOCUMENT_BUCKET, path, token: data.token });
  }

  if (body.action !== 'analyze') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });

  const { max, windowMs } = ROLES_POLICY.extractRateLimit;
  if (!(await checkRateLimit(`roles-intake:${user.id}`, max, windowMs))) {
    return NextResponse.json({ error: 'Too many tries. Pick your work from the list.' }, { status: 429 });
  }

  const text = cleanMatchText(body.text);
  let photo: string | null = null;
  if (typeof body.photo === 'string' && body.photo) {
    const raw = body.photo.replace(/^data:image\/jpeg;base64,/, '');
    if (raw.length <= MAX_IMAGE_CHARS && /^[A-Za-z0-9+/=]+$/.test(raw)) photo = raw;
  }
  const files = Array.isArray(body.files) ? (body.files as { path?: unknown; kind?: unknown; mime?: unknown }[]).slice(0, 3) : [];

  try {
    const roles = await getRoles();
    const candidates = matchCandidates(roles.map((r) => ({ slug: r.slug, name: r.name, description: r.description })), RENTAL_CATEGORIES);

    // Facts: every CV or voice note, then the typed words.
    let facts: ProfileFacts = { ...EMPTY_FACTS };
    let source: 'cv' | 'voice' | 'text' | null = null;
    for (const f of files) {
      const path = typeof f.path === 'string' ? f.path : '';
      const kind = f.kind === 'cv' ? 'cv' : f.kind === 'audio' ? 'voice' : null;
      const mime = typeof f.mime === 'string' ? f.mime.slice(0, 100) : '';
      if (!kind || !path.startsWith(`${user.id}/intake/`) || path.includes('..')) continue;
      const { data: blob } = await admin.storage.from(ROLE_DOCUMENT_BUCKET).download(path);
      if (!blob || blob.size > MAX_FILE_BYTES) continue;
      const data = Buffer.from(await blob.arrayBuffer());
      const result = await extractFacts({ kind, mime: mime || blob.type || 'application/octet-stream', data }, user.id);
      facts = mergeFacts(facts, result.facts);
      source = source ?? kind;
    }
    if (text) {
      const result = await extractFacts({ kind: 'text', text }, user.id);
      facts = mergeFacts(facts, result.facts);
      source = source ?? 'text';
    }

    // The role: from the words (and what the facts say), plus one photo.
    const words = [text, facts.roles.join(' '), facts.skills.join(' '), facts.vehicles.length ? 'driver vehicle' : ''].filter(Boolean).join('. ');
    const match = words || photo
      ? await suggestRoles({ text: cleanMatchText(words), imageBase64: photo, roles: candidates, userId: user.id, mode: 'offer' })
      : { suggestions: [], source: 'keywords' as const };
    const suggestions = (match.suggestions.length ? match.suggestions : keywordMatch(words, candidates, 'offer')).flatMap((s): { slug: string; name: string; status: 'live' | 'coming_soon'; kind: 'role' | 'gear' }[] => {
      const r = roles.find((x) => x.slug === s.slug);
      if (r) return [{ slug: r.slug, name: r.name, status: r.status, kind: 'role' as const }];
      const c = candidates.find((x) => x.slug === s.slug);
      return c ? [{ slug: c.slug, name: c.name, status: 'live' as const, kind: 'gear' as const }] : [];
    });

    return NextResponse.json({ suggestions, facts, factsSource: source });
  } catch {
    console.error('[roles/intake] analyze failed');
    return NextResponse.json({ error: 'Could not read that right now. Pick your work from the list.' }, { status: 500 });
  }
}
