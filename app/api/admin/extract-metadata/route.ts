export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { extractMetadataFromUrl, type ImageMetadata } from '@/lib/metadata/extract';

// ─── POST — Extract EXIF metadata from image URLs (admin only) ──────────────

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const body = await req.json();

    // Single URL
    if (typeof body.imageUrl === 'string') {
      const metadata = await extractMetadataFromUrl(body.imageUrl);
      return NextResponse.json(metadata);
    }

    // Multiple URLs
    if (Array.isArray(body.imageUrls)) {
      const results: { url: string; metadata: ImageMetadata }[] = await Promise.all(
        (body.imageUrls as string[]).map(async (url) => ({
          url,
          metadata: await extractMetadataFromUrl(url),
        })),
      );
      return NextResponse.json(results);
    }

    return NextResponse.json(
      { error: 'Provide "imageUrl" (string) or "imageUrls" (string[]).' },
      { status: 400 },
    );
  } catch (err) {
    console.error('[admin/extract-metadata] Error:', err);
    return NextResponse.json(
      { error: 'Failed to extract metadata.' },
      { status: 500 },
    );
  }
}
