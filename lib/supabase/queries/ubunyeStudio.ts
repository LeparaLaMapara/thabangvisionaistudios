import type { SupabaseClient } from '@supabase/supabase-js';
import type { StudioContext, GearSummary, CreatorSummary, ProductionSummary } from '@/types/ubunye';

/**
 * What the Ubunye AI studio page shows: the newest live gear, featured
 * creators and the newest published productions.
 *
 * Neither smart_rentals nor smart_productions has a `status` column. Live
 * gear is published, not archived, not deleted and available (the same rule
 * as the home showcase); a production is live when published and not
 * deleted. A failed read is logged and shows as an empty row.
 */
export async function loadStudioContext(supabase: SupabaseClient): Promise<StudioContext> {
  const [rentalsRes, crewRes, productionsRes] = await Promise.all([
    supabase
      .from('smart_rentals')
      .select('id, slug, title, category, brand, thumbnail_url, price_per_day, is_available')
      .eq('is_published', true)
      .eq('is_archived', false)
      .is('deleted_at', null)
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
      .eq('is_published', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(4),
  ]);

  if (rentalsRes.error) console.error('[ubunye-studio] gear read failed:', rentalsRes.error.message);
  if (crewRes.error) console.error('[ubunye-studio] creators read failed:', crewRes.error.message);
  if (productionsRes.error) console.error('[ubunye-studio] productions read failed:', productionsRes.error.message);

  const featuredGear: GearSummary[] = ((rentalsRes.data ?? []) as GearSummary[]).map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    category: r.category,
    brand: r.brand,
    thumbnail_url: r.thumbnail_url,
    price_per_day: r.price_per_day,
    is_available: r.is_available,
  }));

  const featuredCreators: CreatorSummary[] = ((crewRes.data ?? []) as CreatorSummary[]).map((c) => ({
    id: c.id,
    display_name: c.display_name,
    crew_slug: c.crew_slug,
    avatar_url: c.avatar_url,
    specializations: c.specializations,
    hourly_rate: c.hourly_rate,
    location: c.location,
  }));

  const featuredProductions: ProductionSummary[] = ((productionsRes.data ?? []) as ProductionSummary[]).map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    project_type: p.project_type,
    client: p.client,
    thumbnail_url: p.thumbnail_url,
  }));

  return { featuredGear, featuredCreators, featuredProductions };
}
