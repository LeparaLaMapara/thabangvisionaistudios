export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { storage } from '@/lib/storage';

/**
 * POST /api/cloudinary/delete
 *
 * Deletes a single asset from the storage provider.
 * Requires admin access — only admins can delete assets.
 *
 * Body: { public_id: string, resource_type?: 'image' | 'video' | 'raw' }
 * Returns: { success: true } | { error: string }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  if (!storage.isConfigured()) {
    return NextResponse.json(
      { error: 'Storage provider is not configured on the server.' },
      { status: 500 },
    );
  }

  let public_id: string;
  let resource_type: 'image' | 'video' | 'raw';

  try {
    const body = await req.json() as {
      public_id: string;
      resource_type?: 'image' | 'video' | 'raw';
    };
    public_id = body.public_id;
    resource_type = body.resource_type ?? 'image';
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!public_id?.trim()) {
    return NextResponse.json({ error: 'public_id is required.' }, { status: 400 });
  }

  try {
    await storage.deleteImage(public_id, resource_type);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Delete failed';
    console.error('[delete] Storage error:', message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
