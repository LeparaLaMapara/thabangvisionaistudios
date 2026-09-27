import type { MetadataRoute } from 'next';
import { STUDIO, RENTAL_CATEGORIES, PRODUCTION_CATEGORIES } from '@/lib/constants';
import { createAdminClient } from '@/lib/supabase/server';
import { SA_CITIES, RENTAL_CITIES, COUNTRY_SLUG } from '@/lib/seo/cities';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = STUDIO.meta.url;
  const supabase = createAdminClient();

  // ── Static pages ──────────────────────────────────────────────────────────
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, changeFrequency: 'weekly', priority: 1.0 },
    { url: `${baseUrl}/about`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/contact`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/careers`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${baseUrl}/press`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${baseUrl}/locations`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${baseUrl}/rentals`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${baseUrl}/studio`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/marketplace`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${baseUrl}/smart-creators`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${baseUrl}/pricing`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/ubunye-ai-studio`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/faq`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${baseUrl}/login`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/register`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/legal`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${baseUrl}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${baseUrl}/refunds`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${baseUrl}/unsubscribe`, changeFrequency: 'yearly', priority: 0.1 },
  ];

  // ── Dynamic: Smart Rentals ────────────────────────────────────────────────
  const { data: rentals } = await supabase
    .from('smart_rentals')
    .select('category, slug, updated_at')
    .eq('is_published', true)
    .is('deleted_at', null);

  const rentalPages: MetadataRoute.Sitemap = (rentals ?? []).map((r) => ({
    url: `${baseUrl}/rentals/${encodeURIComponent(r.category)}/${encodeURIComponent(r.slug)}`,
    lastModified: r.updated_at,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  // Unique rental categories
  const rentalCategories = [...new Set((rentals ?? []).map((r) => r.category))];
  const rentalCategoryPages: MetadataRoute.Sitemap = rentalCategories.map((cat) => ({
    url: `${baseUrl}/rentals/${encodeURIComponent(cat)}`,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }));

  // ── Dynamic: Smart Productions ────────────────────────────────────────────
  const { data: productions } = await supabase
    .from('smart_productions')
    .select('slug, updated_at')
    .eq('is_published', true)
    .is('deleted_at', null);

  const productionPages: MetadataRoute.Sitemap = (productions ?? []).map((p) => ({
    url: `${baseUrl}/studio/${encodeURIComponent(p.slug)}`,
    lastModified: p.updated_at,
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }));

  // ── Dynamic: Production Categories ────────────────────────────────────────
  const { data: categories } = await supabase
    .from('production_categories')
    .select('slug')
    .eq('is_published', true);

  const categoryPages: MetadataRoute.Sitemap = (categories ?? []).map((c) => ({
    url: `${baseUrl}/studio/category/${encodeURIComponent(c.slug)}`,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }));

  // ── Dynamic: Press ────────────────────────────────────────────────────────
  const { data: articles } = await supabase
    .from('press')
    .select('slug, updated_at')
    .eq('is_published', true)
    .is('deleted_at', null);

  const pressPages: MetadataRoute.Sitemap = (articles ?? []).map((a) => ({
    url: `${baseUrl}/press/${encodeURIComponent(a.slug)}`,
    lastModified: a.updated_at,
    changeFrequency: 'monthly' as const,
    priority: 0.5,
  }));

  // ── Dynamic: Marketplace Listings ─────────────────────────────────────────
  const { data: listings } = await supabase
    .from('listings')
    .select('slug, updated_at')
    .eq('is_published', true)
    .is('deleted_at', null);

  const listingPages: MetadataRoute.Sitemap = (listings ?? []).map((l) => ({
    url: `${baseUrl}/marketplace/${encodeURIComponent(l.slug)}`,
    lastModified: l.updated_at,
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }));

  // ── Location Pages: Rentals × Cities ──────────────────────────────────────
  const locationSlugs = [...SA_CITIES.map((c) => c.slug), COUNTRY_SLUG];
  const rentalLocationPages: MetadataRoute.Sitemap = [];
  // Only the cities gear reaches (lib/seo/cities.ts deliversRentals).
  const rentalLocationSlugs = [...RENTAL_CITIES.map((c) => c.slug), COUNTRY_SLUG];
  for (const cat of RENTAL_CATEGORIES) {
    for (const loc of rentalLocationSlugs) {
      rentalLocationPages.push({
        url: `${baseUrl}/rentals/${encodeURIComponent(cat.value)}/in/${loc}`,
        changeFrequency: 'weekly',
        priority: loc === COUNTRY_SLUG ? 0.8 : 0.7,
      });
    }
  }

  // ── Location Pages: Studio Categories × Cities ───────────────────────────
  const studioLocationPages: MetadataRoute.Sitemap = [];
  for (const cat of PRODUCTION_CATEGORIES) {
    for (const loc of locationSlugs) {
      studioLocationPages.push({
        url: `${baseUrl}/studio/category/${encodeURIComponent(cat.slug)}/in/${loc}`,
        changeFrequency: 'weekly',
        priority: loc === COUNTRY_SLUG ? 0.8 : 0.7,
      });
    }
  }

  return [
    ...staticPages,
    ...rentalCategoryPages,
    ...rentalPages,
    ...rentalLocationPages,
    ...productionPages,
    ...categoryPages,
    ...studioLocationPages,
    ...pressPages,
    ...listingPages,
  ];
}
