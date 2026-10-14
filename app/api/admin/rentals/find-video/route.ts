export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { findProductVideo } from '@/lib/video/find-product-video';
import { youtubeSearchConfigured } from '@/lib/video/youtube';

/**
 * Suggest a video for a rental item (admin rental form, "Find video"):
 * YouTube search gives real, embeddable candidates and the vision model picks
 * the one about this exact product, the maker's own video first. Nothing is
 * saved: the form fills the field and the admin saves the listing.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const limited = await rateLimitAdmin(auth.user.id);
  if (limited) return limited;
  if (!youtubeSearchConfigured()) {
    return NextResponse.json({ error: 'YouTube search is not set up (YOUTUBE_API_KEY).' }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const title = str(body?.title, 200);
  if (!title) return NextResponse.json({ error: 'Add the item title first.' }, { status: 400 });
  const imageUrl = str(body?.image_url, 500);

  try {
    const result = await findProductVideo(
      {
        title,
        brand: str(body?.brand, 80),
        model: str(body?.model, 120),
        category: str(body?.category, 80),
        description: str(body?.description, 1000),
        // Only our own image host: the server fetches it.
        imageUrl: imageUrl && imageUrl.startsWith('https://res.cloudinary.com/') ? imageUrl : null,
      },
      auth.user.id,
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error('[admin/rentals/find-video]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not search for a video right now. Try again in a minute.' }, { status: 502 });
  }
}
