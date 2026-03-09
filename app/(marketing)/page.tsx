import { getFeaturedProductions } from '@/lib/supabase/queries/smartProductions';
import { getFeaturedRentals } from '@/lib/supabase/queries/smartRentals';
import { getFeaturedPress } from '@/lib/supabase/queries/press';
import HomeClient from './HomeClient';
import type { CarouselItem } from '@/components/cinematic/LatestWorkCarousel';

export default async function Home() {
  const [productions, rentals, press] = await Promise.all([
    getFeaturedProductions(6),
    getFeaturedRentals(2),
    getFeaturedPress(2),
  ]);

  const carouselItems: CarouselItem[] = [
    ...productions.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      description: p.description,
      thumbnail_url: p.thumbnail_url,
      video_url: p.video_url,
      tags: p.tags ?? [],
      category: 'production' as const,
      meta: [p.client, p.year].filter(Boolean).join(' / ') || 'Production',
      created_at: p.created_at,
    })),
    ...rentals.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      description: r.description,
      thumbnail_url: r.thumbnail_url,
      video_url: r.video_url,
      tags: r.tags ?? [],
      category: 'rental' as const,
      meta: [r.brand, r.model].filter(Boolean).join(' ') || r.category,
      categorySlug: r.category,
      created_at: r.created_at,
    })),
    ...press.map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      description: a.excerpt,
      thumbnail_url: a.cover_url,
      video_url: null,
      tags: a.category ? [a.category] : [],
      category: 'press' as const,
      meta: a.published_at
        ? new Date(a.published_at).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
        : 'Press',
      created_at: a.created_at,
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return <HomeClient carouselItems={carouselItems} />;
}
