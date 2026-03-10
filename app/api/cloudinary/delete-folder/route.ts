export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';

/**
 * POST /api/cloudinary/delete-folder
 *
 * Deletes ALL assets under a given Cloudinary folder prefix.
 * Used exclusively when hard-deleting an entire Smart Production project.
 * Requires admin access — only admins can delete folders.
 *
 * Strategy:
 *   - Cloudinary Admin API  DELETE /resources/{type}/upload?prefix={folder}
 *     removes every asset whose public_id starts with `folder/`.
 *   - We run this for both `image` and `video` resource types in parallel
 *     because a project folder can contain either or both.
 *   - The Admin API uses HTTP Basic Auth (api_key:api_secret), not the
 *     signed-upload approach used by the single-asset /delete route.
 *
 * Body:    { folder: string }
 * Returns: { success: true } | { error: string }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey    = process.env.CLOUDINARY_API_KEY;
  const secret    = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !secret) {
    return NextResponse.json(
      { error: 'Cloudinary is not configured on the server.' },
      { status: 500 },
    );
  }

  let folder: string;

  try {
    const body = await req.json() as { folder?: string };
    folder = body.folder?.trim() ?? '';
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!folder) {
    return NextResponse.json({ error: 'folder is required.' }, { status: 400 });
  }

  // HTTP Basic Auth — used by the Cloudinary Admin API.
  const basicAuth = Buffer.from(`${apiKey}:${secret}`).toString('base64');
  const baseUrl   = `https://api.cloudinary.com/v1_1/${cloudName}`;
  const headers   = { Authorization: `Basic ${basicAuth}` };

  // Delete by prefix for images and videos in parallel.
  // A missing / empty folder returns { deleted: {} } — not an error.
  // invalidate=true clears CDN cache for any deleted assets.
  const resourceTypes = ['image', 'video'] as const;

  try {
    await Promise.all(
      resourceTypes.map(async (resourceType) => {
        const url = `${baseUrl}/resources/${resourceType}/upload?prefix=${encodeURIComponent(folder)}&invalidate=true`;
        const res = await fetch(url, { method: 'DELETE', headers });

        if (!res.ok) {
          const data = await res.json() as { error?: { message: string } };
          const msg  = data.error?.message ?? `Delete failed for ${resourceType} (${res.status})`;
          throw new Error(msg);
        }
      }),
    );
  } catch (err) {
    console.error('[delete-folder] Cloudinary error:', err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
