export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { checkRateLimit } from '@/lib/auth';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { checkCanSubmit, stagingPath, STAGING_NAMES, type PhotoSlot } from '@/lib/verification/submit-guards';

/**
 * Hands out one-time upload links for the two ID-check photos.
 *
 * The photos go from the phone straight to the private `verifications`
 * bucket, never through this server, because Vercel refuses request bodies
 * over 4.5 MB and phone photos are often bigger. The server picks each path
 * (the user's own staging folder, a fresh random name); POST /api/verifications
 * then reads the originals, keeps a small review copy and deletes them.
 */
const BUCKET = 'verifications';

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await checkRateLimit(`verification-upload:${user.id}`, 6, 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
  }

  try {
    const guard = await checkCanSubmit(supabase, user.id);
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

    const admin = createAdminClient();
    const slots = Object.keys(STAGING_NAMES) as PhotoSlot[];
    const links = await Promise.all(
      slots.map(async (slot) => {
        const path = stagingPath(user.id, slot, crypto.randomUUID());
        const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
        return { slot, path, token: data?.token ?? null, error };
      }),
    );

    const failed = links.find((l) => l.error || !l.token);
    if (failed) {
      console.error('[verifications/upload] signed upload URL failed:', failed.error?.message);
      return NextResponse.json({ error: 'Could not prepare the upload. Please try again.' }, { status: 500 });
    }

    return NextResponse.json({
      bucket: BUCKET,
      uploads: Object.fromEntries(links.map((l) => [l.slot, { path: l.path, token: l.token }])),
    });
  } catch (err) {
    console.error('[verifications/upload] Unexpected error:', err);
    return NextResponse.json({ error: 'Could not prepare the upload. Please try again.' }, { status: 500 });
  }
}
