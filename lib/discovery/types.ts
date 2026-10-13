/**
 * The public catalogue, as every discovery surface sees it.
 *
 * lib/discovery/catalog.ts reads it once from the database (cached, tag
 * DISCOVERY_CACHE_TAG); the sitemap, llms.txt, the markdown twins, the
 * catalogue API (/v1) and the MCP server all build from this one object.
 * Only what public pages already show is in here: no emails, phone numbers,
 * ID or bank details, no owner names beyond a public profile's display name.
 */

export interface CatalogRental {
  id: string;
  slug: string;
  title: string;
  category: string;
  categoryLabel: string | null;
  brand: string | null;
  model: string | null;
  description: string | null;
  /** Rands a day, as the gear page shows it. Null when no price is set. */
  pricePerDay: number | null;
  pricePerWeek: number | null;
  /** Refundable deposit in rands, as the gear page shows it. */
  deposit: number | null;
  image: string | null;
  isAvailable: boolean;
  quantity: number;
  /** 'studio' (our own stock) or 'community' (a verified member's gear). */
  ownerType: string;
  /** Set for community gear: that member's public page is /creators/<ownerId>. */
  ownerId: string | null;
  rankingScore: number;
  includes: string[];
  updatedAt: string | null;
  /** Canonical path, /rentals/<category>/<slug>. */
  path: string;
}

export interface CatalogCreator {
  id: string;
  /** The handle in the address: crew slug, else id. */
  handle: string;
  name: string;
  /** The creator's own studio category slug. */
  category: string;
  specializations: string[];
  location: string | null;
  bio: string | null;
  /** Rands an hour as the profile shows it (service VAT applied when registered). */
  hourlyRate: number | null;
  yearsExperience: number | null;
  avatar: string | null;
  /** City slugs (LISTED_CITIES) this creator is based in. */
  citySlugs: string[];
  /** Canonical path, /studio/category/<category>/<handle>. */
  path: string;
}

export interface CatalogMember {
  id: string;
  updatedAt: string | null;
  path: string;
}

export interface CatalogProduction {
  slug: string;
  title: string;
  projectType: string | null;
  description: string | null;
  price: number | null;
  priceUnit: string | null;
  updatedAt: string | null;
  path: string;
}

export interface CatalogStudioCategory {
  slug: string;
  name: string;
  description: string | null;
  creatorKeywords: string[];
  updatedAt: string | null;
  path: string;
}

export interface CatalogPress {
  slug: string;
  title: string;
  excerpt: string | null;
  content: string | null;
  author: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  path: string;
}

export interface CatalogListing {
  slug: string;
  title: string;
  updatedAt: string | null;
  path: string;
}

export interface CatalogToolFile {
  name: string;
  url: string;
  size: number;
  sha256: string;
}

export interface CatalogTool {
  slug: string;
  name: string;
  category: string;
  tagline: string;
  capabilities: string[];
  repoUrl: string;
  webUrl: string;
  licence: string;
  version: string | null;
  published: string | null;
  files: CatalogToolFile[];
  path: string;
}

export interface CatalogFaq {
  question: string;
  answer: string;
  category: string | null;
}

export interface Catalog {
  /** When this snapshot was read (ISO). */
  generatedAt: string;
  rentals: CatalogRental[];
  creators: CatalogCreator[];
  members: CatalogMember[];
  /** Whether the /studio tree is on (smart_productions flag). */
  studioOn: boolean;
  productions: CatalogProduction[];
  studioCategories: CatalogStudioCategory[];
  press: CatalogPress[];
  listings: CatalogListing[];
  tools: CatalogTool[];
  /** FAQs the owner published in /admin/faqs (the core ones come from lib/content/faqs.ts). */
  faqs: CatalogFaq[];
}

/** An empty catalogue, for tests and for a database that cannot be read. */
export function emptyCatalog(): Catalog {
  return {
    generatedAt: new Date(0).toISOString(),
    rentals: [],
    creators: [],
    members: [],
    studioOn: false,
    productions: [],
    studioCategories: [],
    press: [],
    listings: [],
    tools: [],
    faqs: [],
  };
}
