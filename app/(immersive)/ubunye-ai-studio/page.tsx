import { Suspense } from 'react';
import { getFeaturedRentals } from '@/lib/supabase/queries/smartRentals';
import { getAvailableCrew } from '@/lib/supabase/queries/crew';
import { getFeaturedProductions } from '@/lib/supabase/queries/smartProductions';
import UbunyeStudioClient from './UbunyeStudioClient';
import type { StudioContext, GearSummary, CreatorSummary, ProductionSummary } from '@/types/ubunye';

async function fetchStudioContext(): Promise<StudioContext> {
  const [rentals, crew, productions] = await Promise.all([
    getFeaturedRentals(4).catch(() => []),
    getAvailableCrew().catch(() => []),
    getFeaturedProductions(4).catch(() => []),
  ]);

  const featuredGear: GearSummary[] = rentals.map(r => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    category: r.category,
    brand: r.brand,
    thumbnail_url: r.thumbnail_url,
    price_per_day: r.price_per_day,
    is_available: r.is_available,
  }));

  const featuredCreators: CreatorSummary[] = crew
    .filter(c => c.crew_featured)
    .slice(0, 6)
    .map(c => ({
      id: c.id,
      display_name: c.display_name,
      crew_slug: c.crew_slug,
      avatar_url: c.avatar_url,
      specializations: c.specializations,
      hourly_rate: c.hourly_rate,
      location: c.location,
    }));

  const featuredProductions: ProductionSummary[] = productions.map(p => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    project_type: p.project_type,
    client: p.client,
    thumbnail_url: p.thumbnail_url,
  }));

  return { featuredGear, featuredCreators, featuredProductions };
}

export default async function UbunyeAIStudioPage() {
  const context = await fetchStudioContext();

  return (
    <Suspense>
      <UbunyeStudioClient context={context} />
    </Suspense>
  );
}
