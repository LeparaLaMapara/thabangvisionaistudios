export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { extractMetadataFromUrl, type ImageMetadata } from '@/lib/metadata/extract';

// Each URL is fetched by the server (through the guarded safeFetch).
const MAX_URLS = 20;

// ─── POST — Extract EXIF metadata from image URLs (admin only) ──────────────

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const limited = await rateLimitAdmin(auth.user.id);
  if (limited) return limited;

  try {
    const body = await req.json();

    // Single URL
    if (typeof body.imageUrl === 'string') {
      const metadata = await extractMetadataFromUrl(body.imageUrl);
      return NextResponse.json(metadata);
    }

    // Multiple URLs
    if (Array.isArray(body.imageUrls)) {
      if (body.imageUrls.length > MAX_URLS || !body.imageUrls.every((u: unknown) => typeof u === 'string')) {
        return NextResponse.json({ error: `Provide at most ${MAX_URLS} image URLs.` }, { status: 400 });
      }
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
