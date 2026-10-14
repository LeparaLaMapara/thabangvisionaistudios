export const dynamic = 'force-dynamic';

import { NextResponse, type NextRequest } from 'next/server';
import { rolesOffResponse } from '@/lib/roles/flag';
import { checkRateLimit } from '@/lib/auth';
import { ROLES_POLICY, STUDIO } from '@/lib/constants';
import { sanitizeClientMetadata } from '@/lib/metadata/verification';
import { storage } from '@/lib/storage';
import { createClient } from '@/lib/supabase/server';
import { EVIDENCE_COLUMNS, getMyPersonRole, getRole } from '@/lib/supabase/queries/roles';
import { classifySource } from '@/lib/roles';

/**
 * Proof for one role.
 *
 *   POST { step_key, kind: 'photo'|'video', url, public_id, from_camera, exif, last_modified, pair_group?, pair_side? }
 *        A photo or clip the browser already uploaded through
 *        /api/cloudinary/sign (into the person's own folder).
 *   POST { kind: 'document', legal_code, path }
 *        A legal document already put in the private bucket via
 *        /api/roles/[slug]/document. Never public.
 *   POST { kind: 'vouch', note }  A vouch request: who can confirm your work.
 *   DELETE ?id=   Remove one item (only while not approved, never a checked one).
 *
 * The server decides `source`: "captured in the app" only when the file came
 * from the camera button and is fresh (lib/roles/proof.ts classifySource).
 * GPS is dropped from what is stored.
 */

type Ctx = { params: Promise<{ slug: string }> };

const KEY = /^[a-z0-9_-]{1,40}$/;

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const off = await rolesOffResponse();
  if (off) return off;
  const { slug } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  if (!(await checkRateLimit(`roles-evidence:${user.id}`, 40, 60_000))) {
    return NextResponse.json({ error: 'Too many uploads. Wait a moment.' }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }

  try {
    const role = await getRole(slug);
    if (!role) return NextResponse.json({ error: 'Unknown kind of work.' }, { status: 404 });
    const mine = await getMyPersonRole(user.id, slug);
    if (!mine) return NextResponse.json({ error: 'Start your profile first.' }, { status: 404 });
    if (mine.personRole.status === 'approved') return NextResponse.json({ error: 'Your profile is live already.' }, { status: 409 });

    const kind = body.kind;
    const row: Record<string, unknown> = { person_role_id: mine.personRole.id };

    if (kind === 'photo' || kind === 'video') {
      const step = role.proof_task.find((s) => s.key === body.step_key);
      if (!step) return NextResponse.json({ error: 'Unknown step.' }, { status: 400 });
      const already = mine.evidence.filter((e) => e.step_key === step.key).length;
      if (already >= ROLES_POLICY.maxFilesPerStep * (step.kind === 'pair' ? 2 : 1)) {
        return NextResponse.json({ error: 'That step is full. Remove one to add another.' }, { status: 409 });
      }
      const url = typeof body.url === 'string' ? body.url : '';
      const publicId = typeof body.public_id === 'string' ? body.public_id : '';
      // Only the person's own uploads in this account's storage.
      const ownFolder = `${STUDIO.security.uploads.userRoot}/${user.id}/`;
      if (!storage.ownsUrl?.(url) || !publicId.startsWith(ownFolder) || !url.includes(publicId)) {
        return NextResponse.json({ error: 'That file did not upload properly. Please try again.' }, { status: 400 });
      }
      const meta = sanitizeClientMetadata(body.exif);
      const lastModified = typeof body.last_modified === 'number' ? body.last_modified : null;
      row.step_key = step.key;
      row.kind = kind;
      row.url = url;
      row.storage_provider = storage.name === 'cloudinary' ? 'cloudinary' : 'local';
      row.storage_ref = publicId;
      row.source = classifySource({ fromCameraButton: body.from_camera === true, exifDate: meta?.dateTaken ?? null, fileLastModified: lastModified, now: Date.now() });
      row.captured_at = meta?.dateTaken ?? (lastModified ? new Date(lastModified).toISOString() : null);
      row.device_summary = meta ? { device: meta.device, software: meta.software, dateTaken: meta.dateTaken, imageWidth: meta.imageWidth, imageHeight: meta.imageHeight } : null;
      if (step.kind === 'pair') {
        const group = typeof body.pair_group === 'string' && /^[a-z0-9-]{1,40}$/.test(body.pair_group) ? body.pair_group : null;
        const side = body.pair_side === 'before' || body.pair_side === 'after' ? body.pair_side : null;
        if (!group || !side) return NextResponse.json({ error: 'Say if this is the before or the after photo.' }, { status: 400 });
        row.pair_group = group;
        row.pair_side = side;
      }
    } else if (kind === 'document') {
      const code = typeof body.legal_code === 'string' ? body.legal_code : '';
      if (!role.legal_requirements.some((r) => r.code === code)) return NextResponse.json({ error: 'Unknown document.' }, { status: 400 });
      const path = typeof body.path === 'string' ? body.path : '';
      if (!path.startsWith(`${user.id}/${mine.personRole.id}/`) || path.includes('..')) {
        return NextResponse.json({ error: 'That file did not upload properly. Please try again.' }, { status: 400 });
      }
      Object.assign(row, { kind: 'document', source: 'uploaded', legal_code: code, step_key: code, storage_provider: 'supabase', storage_ref: path, is_public: false });
    } else if (kind === 'vouch') {
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
      if (note.length < 5 || /[<>]/.test(note)) return NextResponse.json({ error: 'Add a name and a number we can call.' }, { status: 400 });
      Object.assign(row, { kind: 'vouch', source: 'vouched', note, is_public: false });
    } else {
      return NextResponse.json({ error: 'Unknown kind.' }, { status: 400 });
    }

    if (row.step_key !== undefined && row.step_key !== null && !KEY.test(String(row.step_key))) {
      return NextResponse.json({ error: 'Unknown step.' }, { status: 400 });
    }

    const { data, error } = await supabase.from('role_evidence').insert(row).select(EVIDENCE_COLUMNS).single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ evidence: data }, { status: 201 });
  } catch (err) {
    console.error('[roles/evidence] POST failed:', err);
    return NextResponse.json({ error: 'Could not save that. Please try again.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const off = await rolesOffResponse();
  if (off) return off;
  const { slug } = await ctx.params;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Bad id.' }, { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  try {
    const mine = await getMyPersonRole(user.id, slug);
    if (!mine || !mine.evidence.some((e) => e.id === id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    // RLS refuses a checked item or an approved profile; the files stay in
    // storage for the reviewer's record and are swept with the account.
    const { error, count } = await supabase.from('role_evidence').delete({ count: 'exact' }).eq('id', id);
    if (error) throw new Error(error.message);
    if (!count) return NextResponse.json({ error: 'This one is already checked, so it stays.' }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[roles/evidence] DELETE failed:', err);
    return NextResponse.json({ error: 'Could not remove it. Please try again.' }, { status: 500 });
  }
}
