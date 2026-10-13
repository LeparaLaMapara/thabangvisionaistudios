import { getRentalCities, LISTED_CITIES } from '@/lib/seo/cities';
import { creatorProfilePath } from '@/lib/seo/creator-url';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * Which public paths change when one thing changes. Write paths pass these to
 * notifyDiscovery (lib/discovery/notify.ts). They include the lists and
 * category pages the thing appears on, because those change too.
 */

const enc = encodeURIComponent;

/** A rental item: its page, its category and city pages, the index, and its owner's member page. */
export function rentalPaths(row: {
  category?: string | null;
  slug?: string | null;
  owner_type?: string | null;
  owner_id?: string | null;
}): string[] {
  const out = ['/rentals'];
  if (row.category) {
    const cat = enc(row.category);
    out.push(`/rentals/${cat}`);
    if (row.slug) out.push(`/rentals/${cat}/${enc(row.slug)}`);
    for (const city of getRentalCities()) out.push(`/rentals/${cat}/in/${city.slug}`);
  }
  if (row.owner_type === 'community' && row.owner_id) out.push(`/creators/${row.owner_id}`);
  return out;
}

export function pressPaths(slug: string | null | undefined): string[] {
  return slug ? ['/press', `/press/${enc(slug)}`] : ['/press'];
}

export function productionPaths(slug: string | null | undefined): string[] {
  return slug ? ['/studio', `/studio/${enc(slug)}`] : ['/studio'];
}

export function studioCategoryPaths(slug: string | null | undefined): string[] {
  if (!slug) return ['/studio'];
  const cat = enc(slug);
  return ['/studio', `/studio/category/${cat}`, ...LISTED_CITIES.map((c) => `/studio/category/${cat}/in/${c.slug}`)];
}

export function marketplacePaths(slug: string | null | undefined): string[] {
  return slug ? ['/marketplace', `/marketplace/${enc(slug)}`] : ['/marketplace'];
}

/** A creator's pages, worked out from their public profile (read later, in after()). */
export function creatorPathsById(id: string): () => Promise<string[]> {
  return async () => {
    const { data } = await createAdminClient()
      .from('public_profiles')
      .select('id, crew_slug, specializations, location')
      .eq('id', id)
      .maybeSingle();
    const p = data as { id: string; crew_slug: string | null; specializations: string[] | null; location: string | null } | null;
    const out = ['/smart-creators', `/creators/${id}`];
    if (!p) return out;
    const profile = creatorProfilePath(p);
    const category = profile.split('/')[3];
    return [...out, profile, ...studioCategoryPaths(category)];
  };
}

/** Everything a member offers: their gear and, if they are a creator, their profile. */
export function memberPathsById(id: string): () => Promise<string[]> {
  return async () => {
    const { data } = await createAdminClient()
      .from('smart_rentals')
      .select('category, slug, owner_type, owner_id')
      .eq('owner_id', id)
      .is('deleted_at', null);
    const gear = ((data ?? []) as { category: string | null; slug: string; owner_type: string | null; owner_id: string | null }[])
      .flatMap(rentalPaths);
    return [...gear, ...(await creatorPathsById(id)())];
  };
}
