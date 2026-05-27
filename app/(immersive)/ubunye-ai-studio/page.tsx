import { Suspense } from 'react';
import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import UbunyeStudioClient from './UbunyeStudioClient';
import type { StudioContext, GearSummary, CreatorSummary, ProductionSummary } from '@/types/ubunye';

const getStudioContext = unstable_cache(
  async (): Promise<StudioContext> => {
    const supabase = createAdminClient();

    const [rentalsRes, crewRes, productionsRes] = await Promise.all([
      supabase
        .from('smart_rentals')
        .select('id, slug, title, category, brand, thumbnail_url, price_per_day, is_available')
        .eq('status', 'published')
        .eq('is_available', true)
        .order('created_at', { ascending: false })
        .limit(4),
      supabase
        .from('public_profiles')
        .select('id, display_name, crew_slug, avatar_url, specializations, hourly_rate, location, crew_featured')
        .eq('crew_featured', true)
        .limit(6),
      supabase
        .from('smart_productions')
        .select('id, slug, title, project_type, client, thumbnail_url')
        .eq('status', 'published')
        .order('created_at', { ascending: false })
        .limit(4),
    ]);

    const featuredGear: GearSummary[] = (rentalsRes.data ?? []).map(r => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      category: r.category,
      brand: r.brand,
      thumbnail_url: r.thumbnail_url,
      price_per_day: r.price_per_day,
      is_available: r.is_available,
    }));

    const featuredCreators: CreatorSummary[] = (crewRes.data ?? []).map(c => ({
      id: c.id,
      display_name: c.display_name,
      crew_slug: c.crew_slug,
      avatar_url: c.avatar_url,
      specializations: c.specializations,
      hourly_rate: c.hourly_rate,
      location: c.location,
    }));

    const featuredProductions: ProductionSummary[] = (productionsRes.data ?? []).map(p => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      project_type: p.project_type,
      client: p.client,
      thumbnail_url: p.thumbnail_url,
    }));

    return { featuredGear, featuredCreators, featuredProductions };
  },
  ['studio-context'],
  { revalidate: 300, tags: ['studio-context'] },
);

export default async function UbunyeAIStudioPage() {
  const context = await getStudioContext();

  return (
    <Suspense>
      <UbunyeStudioClient context={context} />
    </Suspense>
  );
}
