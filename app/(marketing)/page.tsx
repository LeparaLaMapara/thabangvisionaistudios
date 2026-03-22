export const revalidate = 60;

import { getFeaturedProductions } from '@/lib/supabase/queries/smartProductions';
import HomeClient from './HomeClient';
import type { CarouselItem } from '@/components/cinematic/LatestWorkCarousel';

/** Build a Cloudinary delivery URL from a public_id. */
function cloudinaryUrl(publicId: string): string {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  return `https://res.cloudinary.com/${cloud}/image/upload/${publicId}`;
}

/**
 * Resolve the best available image for a DB row.
 * Priority: thumbnail_url → cover_public_id (build URL) → first gallery image → null.
 */
function resolveImage(
  thumbnailUrl: string | null | undefined,
  coverPublicId: string | null | undefined,
  gallery: { url: string; public_id: string }[] | null | undefined,
): string | null {
  if (thumbnailUrl) return thumbnailUrl;
  if (coverPublicId) return cloudinaryUrl(coverPublicId);
  if (gallery && gallery.length > 0) return gallery[0].url;
  return null;
}

export default async function Home() {
  const productions = await getFeaturedProductions(8);

  const carouselItems: CarouselItem[] = productions.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    thumbnail_url: resolveImage(p.thumbnail_url, p.cover_public_id, p.gallery),
    video_url: p.video_url,
    tags: p.tags ?? [],
    category: 'production' as const,
    meta: [p.client, p.year].filter(Boolean).join(' / ') || 'Production',
    created_at: p.created_at,
  })).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return <HomeClient carouselItems={carouselItems} />;
}
