export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, checkRateLimit, isAdmin } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { uploadPolicy } from '@/lib/storage/upload-policy';

/**
 * POST /api/cloudinary/sign
 * Returns signed upload params so clients can upload directly to
 * the storage provider without exposing secrets.
 * Requires authentication — only logged-in users can sign uploads.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  // H3: Rate limit uploads — 20 requests per minute per user
  if (!(await checkRateLimit(`storage:${auth.user.id}`, 20, 60_000))) {
    return NextResponse.json(
      { error: 'Too many upload requests. Please wait before trying again.' },
      { status: 429 },
    );
  }

  if (!storage.isConfigured()) {
    return NextResponse.json(
      { error: 'Storage provider is not configured on the server.' },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const requested = ((body as { paramsToSign?: unknown } | null)?.paramsToSign ?? {}) as Record<string, unknown>;
  if (typeof requested !== 'object' || requested === null) {
    return NextResponse.json({ error: 'paramsToSign must be an object.' }, { status: 400 });
  }

  // The SERVER decides what is signed (security INJ-5): a folder in the
  // user's own namespace (admins may name one), image or video only, and
  // allowed_formats. A client public_id or any other parameter is ignored.
  const admin = await isAdmin(auth.user.id, auth.user.email);
  const policy = uploadPolicy(auth.user.id, admin, requested);
  if (!policy) {
    return NextResponse.json({ error: 'Only image or video uploads can be signed.' }, { status: 400 });
  }

  try {
    const signed = await storage.getSignedUploadParams(policy.folder, policy.params);

    return NextResponse.json({
      signature: signed.signature,
      timestamp: signed.timestamp,
      cloudName: signed.fields.cloud_name,
      apiKey: signed.fields.api_key,
      // Post exactly these with the file (they are what was signed).
      folder: policy.folder,
      params: { ...policy.params, timestamp: signed.timestamp },
      resourceType: policy.kind,
    });
  } catch (err) {
    console.error('[sign] Storage error:', err);
    return NextResponse.json(
      { error: 'Failed to generate upload signature.' },
      { status: 500 },
    );
  }
}
