export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';

/**
 * POST /api/cloudinary/sign
 * Returns a signed upload signature so clients can upload directly to
 * Cloudinary without ever seeing CLOUDINARY_API_SECRET.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'Cloudinary is not configured on the server.' },
      { status: 500 },
    );
  }

  const { paramsToSign } = await req.json();

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
