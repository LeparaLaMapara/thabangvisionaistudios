export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { storage } from '@/lib/storage';

/**
 * POST /api/cloudinary/delete-folder
 *
 * Deletes ALL assets under a given folder prefix.
 * Used when hard-deleting an entire project.
 * Requires admin access — only admins can delete folders.
 *
 * Body:    { folder: string }
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

  try {
    await storage.deleteFolder(folder);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Delete failed';
    console.error('[delete-folder] Storage error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
