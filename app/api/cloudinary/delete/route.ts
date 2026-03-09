export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';

/**
 * POST /api/cloudinary/delete
 *
 * Deletes a single asset from Cloudinary using a server-side signed request.
 * CLOUDINARY_API_SECRET never leaves the server.
 *
 * Body: { public_id: string, resource_type?: 'image' | 'video' | 'raw' }
 * Returns: { success: true } | { error: string }
 */
export async function POST(req: NextRequest) {
  const secret    = process.env.CLOUDINARY_API_SECRET;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey    = process.env.CLOUDINARY_API_KEY;

  if (!secret || !cloudName || !apiKey) {
    return NextResponse.json(
      { error: 'Cloudinary is not configured on the server.' },
      { status: 500 },
    );
  }

  let public_id: string;
  let resource_type: string;

  try {
    const body = await req.json() as {
      public_id: string;
      resource_type?: 'image' | 'video' | 'raw';
    };
    public_id     = body.public_id;
    resource_type = body.resource_type ?? 'image';
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!public_id?.trim()) {
    return NextResponse.json({ error: 'public_id is required.' }, { status: 400 });
  }

  const timestamp = Math.round(Date.now() / 1000).toString();

  // Signature: same SHA-256 algorithm used by the sign route.
  // Params must be sorted alphabetically before hashing.
  const paramsToSign: Record<string, string> = { public_id, timestamp };

  const toSign =
    Object.entries(paramsToSign)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&') + secret;

  const signature = crypto.createHash('sha256').update(toSign).digest('hex');

  // Cloudinary Admin API — destroy endpoint
  const form = new URLSearchParams({
    public_id,
    signature,
    api_key:   apiKey,
    timestamp,
  });

  let cloudinaryRes: Response;
  try {
    cloudinaryRes = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/${resource_type}/destroy`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    form.toString(),
      },
    );
  } catch (err) {
    console.error('Cloudinary destroy network error:', err);
    return NextResponse.json(
      { error: 'Network error reaching Cloudinary.' },
      { status: 502 },
    );
  }

  const data = await cloudinaryRes.json() as {
    result?: string;
    error?:  { message: string };
  };

  // Cloudinary returns { result: 'ok' } on success, { result: 'not found' } or
  // { error: { message } } on failure.
  if (!cloudinaryRes.ok || (data.result && data.result !== 'ok')) {
    const msg = data.error?.message ?? `Unexpected result: ${data.result}`;
    console.error('Cloudinary destroy error:', data);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
