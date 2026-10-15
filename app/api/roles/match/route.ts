export const dynamic = 'force-dynamic';

import { NextResponse, type NextRequest } from 'next/server';
import { rolesOffResponse } from '@/lib/roles/flag';
import { checkRateLimit } from '@/lib/auth';
import { GEAR_RENTAL_CATEGORIES, ROLES_POLICY } from '@/lib/constants';
import { createClient } from '@/lib/supabase/server';
import { getRoles } from '@/lib/supabase/queries/roles';
import { cleanMatchText, matchCandidates, type MatchMode } from '@/lib/roles';
import { suggestRoles } from '@/lib/roles/match-ai';

/**
 * Match words (and one photo) to roles and gear. Agent 'role-match'.
 *
 *   POST { text?, image? }
 *   -> { suggestions: [{ slug, name, status, kind: 'role' | 'gear', confidence }], source }
 *
 * The Offer step only (signed in, rate limited per person). Candidates are
 * the roles plus the rental categories ("gear:<category>").
 * Only the cleaned words and the photo go to the model; nothing personal is
 * logged. Suggests only; the person confirms or picks.
 */

const MAX_IMAGE_CHARS = 1_400_000; // about 1 MB of JPEG

interface MatchOut {
  slug: string;
  name: string;
  status: 'live' | 'coming_soon';
  kind: 'role' | 'gear';
  confidence: number;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const off = await rolesOffResponse();
  if (off) return off;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }
  // Offer only for now: finding is the site's existing browse pages.
  const mode: MatchMode = 'offer';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });

  const { max, windowMs } = ROLES_POLICY.matchRateLimit;
  if (!(await checkRateLimit(`role-match:${user.id}`, max, windowMs))) {
    return NextResponse.json({ error: 'Too many tries. Pick from the list below.' }, { status: 429 });
  }

  const text = cleanMatchText(body.text);
  let image: string | null = null;
  if (typeof body.image === 'string' && body.image) {
    const raw = body.image.replace(/^data:image\/jpeg;base64,/, '');
    if (raw.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/=]+$/.test(raw)) {
      return NextResponse.json({ error: 'That photo is too big. Try another one.' }, { status: 400 });
    }
    image = raw;
  }
  if (!text && !image) return NextResponse.json({ error: 'Tell us in a few words, or add a photo.' }, { status: 400 });

  try {
    const roles = await getRoles();
    const candidates = matchCandidates(
      roles.map((r) => ({ slug: r.slug, name: r.name, description: r.description })),
      // Gear only: offering a studio space is the location-studio role.
      GEAR_RENTAL_CATEGORIES,
    );
    const result = await suggestRoles({ text, imageBase64: image, roles: candidates, userId: user.id, mode });
    return NextResponse.json({
      source: result.source,
      suggestions: result.suggestions.flatMap((s): MatchOut[] => {
        const role = roles.find((r) => r.slug === s.slug);
        if (role) return [{ slug: role.slug, name: role.name, status: role.status, kind: 'role' as const, confidence: s.confidence }];
        const c = candidates.find((x) => x.slug === s.slug);
        return c ? [{ slug: c.slug, name: c.name, status: 'live' as const, kind: 'gear' as const, confidence: s.confidence }] : [];
      }),
    });
  } catch {
    console.error('[roles/match] failed');
    return NextResponse.json({ error: 'Could not match right now. Pick from the list below.' }, { status: 500 });
  }
}
