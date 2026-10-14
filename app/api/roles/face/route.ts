export const dynamic = 'force-dynamic';

import crypto from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { rolesOffResponse } from '@/lib/roles/flag';
import { checkRateLimit } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { getIdentityFacts, getMyFace, ROLE_DOCUMENT_BUCKET } from '@/lib/supabase/queries/roles';

/**
 * Screen 1, "Your photo". The face photo is private: it goes to the private
 * role-documents bucket and is shown to a client only after a confirmed
 * booking (lib/roles/reveal.ts). One face per person, for every role.
 *
 *   GET                                  { hasFace, url } (the person's own, short-lived link)
 *   POST { action: 'upload' }            -> { bucket, path, token } one-time upload link
 *   POST { action: 'save', path, captured_at? }  records it; a reviewer compares it with the ID selfie
 */

async function user() {
  const supabase = await createClient();
  const {
    data: { user: u },
  } = await supabase.auth.getUser();
  return u;
}

export async function GET(): Promise<NextResponse> {
  const off = await rolesOffResponse();
  if (off) return off;
  const u = await user();
  if (!u) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const face = await getMyFace(u.id);
  return NextResponse.json({ hasFace: !!face, url: face?.url ?? null });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const off = await rolesOffResponse();
  if (off) return off;
  const u = await user();
  if (!u) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  if (!(await checkRateLimit(`roles-face:${u.id}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many tries. Wait a moment.' }, { status: 429 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* handled below */
  }

  try {
    const admin = createAdminClient();
    if (body.action === 'upload') {
      const path = `${u.id}/face/${crypto.randomUUID()}.jpg`;
      const { data, error } = await admin.storage.from(ROLE_DOCUMENT_BUCKET).createSignedUploadUrl(path);
      if (error || !data?.token) return NextResponse.json({ error: 'Could not prepare the upload. Please try again.' }, { status: 500 });
      return NextResponse.json({ bucket: ROLE_DOCUMENT_BUCKET, path, token: data.token });
    }
    if (body.action === 'save') {
      const path = typeof body.path === 'string' ? body.path : '';
      if (!path.startsWith(`${u.id}/face/`) || path.includes('..')) {
        return NextResponse.json({ error: 'That photo did not upload properly. Please take it again.' }, { status: 400 });
      }
      const captured = typeof body.captured_at === 'string' && !Number.isNaN(Date.parse(body.captured_at)) ? new Date(body.captured_at).toISOString() : null;
      const identity = await getIdentityFacts(u.id);
      const { error } = await admin.from('person_faces').upsert({
        user_id: u.id,
        storage_ref: path,
        captured_at: captured,
        face_check: identity.hasIdSelfie ? 'to_compare' : 'no_id_selfie',
        checked_by: null,
        checked_at: null,
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch {
    console.error('[roles/face] failed');
    return NextResponse.json({ error: 'Could not save your photo. Please try again.' }, { status: 500 });
  }
}
