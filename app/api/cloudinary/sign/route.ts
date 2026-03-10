export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, checkRateLimit } from '@/lib/auth';
import { storage } from '@/lib/storage';

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
  if (!checkRateLimit(`storage:${auth.user.id}`, 20, 60_000)) {
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

  const { paramsToSign } = await req.json();
  const params = paramsToSign as Record<string, string>;

  // H4: Validate upload parameters — enforce allowed resource types
  const allowedResourceTypes = ['image', 'video', 'raw'];
  if (params.resource_type && !allowedResourceTypes.includes(params.resource_type)) {
    return NextResponse.json(
      { error: `Invalid resource_type. Allowed: ${allowedResourceTypes.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    const folder = params.folder ?? '';
    const signed = await storage.getSignedUploadParams(folder, params);

    return NextResponse.json({
      signature: signed.signature,
      cloudName: signed.fields.cloud_name,
      apiKey: signed.fields.api_key,
    });
  } catch (err) {
    console.error('[sign] Storage error:', err);
    return NextResponse.json(
      { error: 'Failed to generate upload signature.' },
      { status: 500 },
    );
  }
}
