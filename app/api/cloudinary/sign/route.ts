export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireAuth, checkRateLimit } from '@/lib/auth';

/**
 * POST /api/cloudinary/sign
 * Returns a signed upload signature so clients can upload directly to
 * Cloudinary without ever seeing CLOUDINARY_API_SECRET.
 * Requires authentication — only logged-in users can sign uploads.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  // H3: Rate limit uploads — 20 requests per minute per user
  if (!checkRateLimit(`cloudinary:${auth.user.id}`, 20, 60_000)) {
    return NextResponse.json(
      { error: 'Too many upload requests. Please wait before trying again.' },
      { status: 429 },
    );
  }

  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'Cloudinary is not configured on the server.' },
      { status: 500 },
    );
  }

  const { paramsToSign } = await req.json();

  // H4: Validate upload parameters — enforce allowed resource types
  const params = paramsToSign as Record<string, string>;
  const allowedResourceTypes = ['image', 'video', 'raw'];
  if (params.resource_type && !allowedResourceTypes.includes(params.resource_type)) {
    return NextResponse.json(
      { error: `Invalid resource_type. Allowed: ${allowedResourceTypes.join(', ')}` },
      { status: 400 },
    );
  }

  // Cloudinary signature: alphabetically sorted key=value pairs + secret
  const toSign =
    Object.entries(paramsToSign as Record<string, string>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&') + secret;

  const signature = crypto.createHash('sha256').update(toSign).digest('hex');

  return NextResponse.json({
    signature,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey:    process.env.CLOUDINARY_API_KEY, // public key — safe to return
  });
}
