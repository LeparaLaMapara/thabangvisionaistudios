import { unstable_cache } from 'next/cache';
import { PRODUCTION_CATEGORIES, RENTAL_CATEGORIES, UBUNYE_STUDIO } from '@/lib/constants';
import { createAdminClient } from '@/lib/supabase/server';
import { getFlag } from '@/lib/features';
import { getUbunyeRelease } from '@/lib/ubunye-release';
import { LISTED_CITIES, locationMatchesCity } from '@/lib/seo/cities';
import { creatorCategorySlug, creatorHandle, creatorProfilePath, isListedCreator } from '@/lib/seo/creator-url';
import { newest } from '@/lib/seo/inventory';
import { withServiceVat } from '@/lib/format/money';
import type { PortfolioProject } from '@/types/portfolio';
import type {
  Catalog,
  CatalogCreator,
  CatalogFaq,
  CatalogListing,
  CatalogMember,
  CatalogPress,
  CatalogProduction,
  CatalogRental,
  CatalogStudioCategory,
  CatalogTool,
} from '@/lib/discovery/types';

/**
 * Reads the public catalogue once. Every discovery surface (sitemap,
 * llms.txt, markdown twins, /v1 catalogue API, /mcp) builds from it, so they
 * always agree with each other and with the pages.
 *
 * Cached for an hour under DISCOVERY_CACHE_TAG. notifyDiscovery()
 * (lib/discovery/notify.ts) marks the tag stale when an admin or owner
 * publishes, edits or takes something down, so the surfaces catch up on the
 * next request instead of waiting out the hour.
 *
 * Same filters as the pages: published, not deleted; creators verified, open
 * for hire, with a complete portfolio. Reads use the server key (no cookies
 * inside a cache) and select only columns that public pages already show.
 */

export const DISCOVERY_CACHE_TAG = 'discovery';
export const DISCOVERY_CACHE_SECONDS = 3600;

const enc = encodeURIComponent;

type RentalDbRow = {
  id: string;
  slug: string;
  title: string;
  category: string | null;
  brand: string | null;
  model: string | null;
  description: string | null;
  price_per_day: number | string | null;
  price_per_week: number | string | null;
  deposit_amount: number | string | null;
  thumbnail_url: string | null;
  is_available: boolean | null;
  quantity: number | null;
  owner_type: string | null;
  owner_id: string | null;
  ranking_score: number | string | null;
  rental_includes: string[] | null;
  updated_at: string | null;
};

type CreatorDbRow = {
  id: string;
  display_name: string | null;
  crew_slug: string | null;
  specializations: string[] | null;
  location: string | null;
  bio: string | null;
  crew_bio: string | null;
  hourly_rate: number | null;
  years_experience: number | null;
  avatar_url: string | null;
  verification_status: string | null;
  available_for_hire: boolean | null;
  portfolio_projects: PortfolioProject[] | null;
};

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Pure mapping of rental rows, exported for tests. */
export function toCatalogRentals(rows: RentalDbRow[]): CatalogRental[] {
  return rows
    .filter((r) => r.category && r.slug)
    .map((r) => {
      const category = r.category as string;
      const price = num(r.price_per_day);
      return {
        id: r.id,
        slug: r.slug,
        title: r.title || r.slug,
        category,
        categoryLabel: RENTAL_CATEGORIES.find((c) => c.value === category)?.label ?? null,
        brand: r.brand,
        model: r.model,
        description: r.description,
        pricePerDay: price !== null && price > 0 ? price : null,
        pricePerWeek: num(r.price_per_week),
        deposit: num(r.deposit_amount),
        image: r.thumbnail_url,
        isAvailable: r.is_available !== false,
        quantity: r.quantity ?? 1,
        ownerType: r.owner_type ?? 'studio',
        ownerId: r.owner_type === 'community' ? r.owner_id : null,
        rankingScore: num(r.ranking_score) ?? 0,
        includes: Array.isArray(r.rental_includes) ? r.rental_includes : [],
        updatedAt: r.updated_at,
        path: `/rentals/${enc(category)}/${enc(r.slug)}`,
      };
    })
    .sort((a, b) => b.rankingScore - a.rankingScore || a.title.localeCompare(b.title));
}

/** Pure mapping of creator rows (listed creators only), exported for tests. */
export function toCatalogCreators(rows: CreatorDbRow[]): CatalogCreator[] {
  return rows.filter(isListedCreator).map((c) => ({
    id: c.id,
    handle: creatorHandle(c),
    name: c.display_name ?? 'Creator',
    category: creatorCategorySlug(c.specializations),
    specializations: c.specializations ?? [],
    location: c.location,
    bio: c.crew_bio ?? c.bio,
    hourlyRate: c.hourly_rate != null ? withServiceVat(c.hourly_rate) : null,
    yearsExperience: c.years_experience,
    avatar: c.avatar_url,
    citySlugs: LISTED_CITIES.filter((city) => locationMatchesCity(c.location, city)).map((city) => city.slug),
    path: creatorProfilePath(c),
  }));
}

async function readRentals(): Promise<CatalogRental[]> {
  const { data, error } = await createAdminClient()
    .from('smart_rentals')
    .select(
      'id, slug, title, category, brand, model, description, price_per_day, price_per_week, deposit_amount, thumbnail_url, is_available, quantity, owner_type, owner_id, ranking_score, rental_includes, updated_at',
    )
    .eq('is_published', true)
    .is('deleted_at', null)
    .limit(5000);
  if (error) console.error('[discovery:rentals]', error.message);
  return toCatalogRentals((data ?? []) as unknown as RentalDbRow[]);
}

async function readCreators(): Promise<CatalogCreator[]> {
  const { data, error } = await createAdminClient()
    .from('public_profiles')
    .select(
      'id, display_name, crew_slug, specializations, location, bio, crew_bio, hourly_rate, years_experience, avatar_url, verification_status, available_for_hire, portfolio_projects',
    )
    .eq('verification_status', 'verified')
    .eq('available_for_hire', true);
  if (error) console.error('[discovery:creators]', error.message);
  return toCatalogCreators((data ?? []) as unknown as CreatorDbRow[]);
}

/** Members with community gear for hire who are not listed creators. */
function membersOf(rentals: CatalogRental[], creators: CatalogCreator[]): CatalogMember[] {
  const listed = new Set(creators.map((c) => c.id));
  const latest = new Map<string, string | null>();
  for (const r of rentals) {
    if (!r.ownerId || listed.has(r.ownerId)) continue;
    latest.set(r.ownerId, newest([latest.get(r.ownerId), r.updatedAt]) ?? null);
  }
  return [...latest].map(([id, updatedAt]) => ({ id, updatedAt, path: `/creators/${id}` }));
}

async function readStudio(): Promise<{ productions: CatalogProduction[]; categories: CatalogStudioCategory[] }> {
  const db = createAdminClient();
  const [{ data: prods, error: prodErr }, { data: cats, error: catErr }] = await Promise.all([
    db
      .from('smart_productions')
      .select('slug, title, project_type, description, price, price_unit, updated_at')
      .eq('is_published', true)
      .is('deleted_at', null),
    db
      .from('production_categories')
      .select('slug, name, description, creator_keywords, updated_at, display_order')
      .eq('is_published', true)
      .order('display_order', { ascending: true }),
  ]);
  if (prodErr) console.error('[discovery:productions]', prodErr.message);
  if (catErr) console.error('[discovery:production_categories]', catErr.message);

  type CatRow = { slug: string; name: string; description: string | null; creator_keywords: string[] | null; updated_at: string | null };
  const catRows = (cats ?? []) as CatRow[];
  // The category pages read the database row first and fall back to the
  // constants, so this does the same.
  const categories: CatalogStudioCategory[] =
    catRows.length > 0
      ? catRows.map((c) => ({
          slug: c.slug,
          name: c.name,
          description: c.description,
          creatorKeywords:
            (c.creator_keywords && c.creator_keywords.length > 0
              ? c.creator_keywords
              : PRODUCTION_CATEGORIES.find((p) => p.slug === c.slug)?.creatorKeywords) ?? [],
          updatedAt: c.updated_at,
          path: `/studio/category/${enc(c.slug)}`,
        }))
      : PRODUCTION_CATEGORIES.map((c) => ({
          slug: c.slug,
          name: c.name,
          description: c.description,
          creatorKeywords: c.creatorKeywords,
          updatedAt: null,
          path: `/studio/category/${enc(c.slug)}`,
        }));

  type ProdRow = { slug: string; title: string; project_type: string | null; description: string | null; price: number | null; price_unit: string | null; updated_at: string | null };
  const productions = ((prods ?? []) as ProdRow[]).map((p) => ({
    slug: p.slug,
    title: p.title,
    projectType: p.project_type,
    description: p.description,
    price: p.price,
    priceUnit: p.price_unit,
    updatedAt: p.updated_at,
    path: `/studio/${enc(p.slug)}`,
  }));
  return { productions, categories };
}

async function readPress(): Promise<CatalogPress[]> {
  const { data, error } = await createAdminClient()
    .from('press')
    .select('slug, title, excerpt, content, author, published_at, updated_at')
    .eq('is_published', true)
    .is('deleted_at', null)
    .order('published_at', { ascending: false });
  if (error) console.error('[discovery:press]', error.message);
  type Row = { slug: string; title: string; excerpt: string | null; content: string | null; author: string | null; published_at: string | null; updated_at: string | null };
  return ((data ?? []) as Row[]).map((r) => ({
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    content: r.content,
    author: r.author,
    publishedAt: r.published_at,
    updatedAt: r.updated_at,
    path: `/press/${enc(r.slug)}`,
  }));
}

async function readListings(): Promise<CatalogListing[]> {
  const { data, error } = await createAdminClient()
    .from('listings')
    .select('slug, title, updated_at')
    .eq('is_published', true)
    .is('deleted_at', null);
  if (error) console.error('[discovery:listings]', error.message);
  type Row = { slug: string; title: string; updated_at: string | null };
  return ((data ?? []) as Row[]).map((r) => ({
    slug: r.slug,
    title: r.title,
    updatedAt: r.updated_at,
    path: `/marketplace/${enc(r.slug)}`,
  }));
}

async function readTools(): Promise<CatalogTool[]> {
  const releases = await Promise.all(UBUNYE_STUDIO.apps.map((a) => getUbunyeRelease(a.slug)));
  return UBUNYE_STUDIO.apps.map((a, i) => ({
    slug: a.slug,
    name: a.name,
    category: a.category,
    tagline: a.tagline,
    capabilities: [...a.capabilities],
    repoUrl: a.repoUrl,
    webUrl: a.webUrl,
    licence: UBUNYE_STUDIO.licence,
    version: releases[i]?.version ?? null,
    published: releases[i]?.published ?? null,
    files: releases[i]?.files ?? [],
    path: `/tools/${a.slug}`,
  }));
}

async function readFaqs(): Promise<CatalogFaq[]> {
  const { data, error } = await createAdminClient()
    .from('chat_faqs')
    .select('question, answer, category')
    .eq('is_published', true)
    .order('view_count', { ascending: false })
    .limit(100);
  if (error) console.error('[discovery:faqs]', error.message);
  return ((data ?? []) as CatalogFaq[]).map((f) => ({ question: f.question, answer: f.answer, category: f.category }));
}

/** Reads the catalogue straight from the database (no cache). */
export async function readCatalogFresh(): Promise<Catalog> {
  const [rentals, creators, studioOn, studio, press, listings, tools, faqs] = await Promise.all([
    readRentals(),
    readCreators(),
    getFlag('smart_productions').catch(() => false),
    readStudio(),
    readPress(),
    readListings(),
    readTools(),
    readFaqs(),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    rentals,
    creators,
    members: membersOf(rentals, creators),
    studioOn,
    productions: studio.productions,
    studioCategories: studio.categories,
    press,
    listings,
    tools,
    faqs,
  };
}

const loadCatalogCached = unstable_cache(readCatalogFresh, ['discovery-catalog-v1'], {
  revalidate: DISCOVERY_CACHE_SECONDS,
  tags: [DISCOVERY_CACHE_TAG],
});

/** The catalogue, cached for an hour and refreshed early by notifyDiscovery. */
export async function loadCatalog(): Promise<Catalog> {
  try {
    return await loadCatalogCached();
  } catch (err) {
    // Outside a Next request (scripts) the cache is unavailable; read directly.
    console.error('[discovery] cached catalogue unavailable, reading fresh:', err);
    return readCatalogFresh();
  }
}

