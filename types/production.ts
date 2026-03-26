// ─── Production Categories & Packages ────────────────────────────────────────
// Types for the Smart Productions service catalogue.
// Categories live in production_categories table (DB-driven).
// Packages are defined in lib/constants.ts (constants-driven).

/** Shape used by constants.ts and client components (camelCase) */
export interface ProductionCategory {
  slug: string;
  name: string;
  description: string;
  subTypes: string[];
  startingRate: number;
  startingUnit: 'session' | 'project' | 'package' | 'event';
  /** Maps to project_type in smart_productions table */
  projectType: string;
  /** Keywords to match against profiles.specializations for creator recommendations */
  creatorKeywords: string[];
  /** Optional fields from DB */
  id?: string;
  coverImageUrl?: string | null;
  coverImagePublicId?: string | null;
  icon?: string | null;
  displayOrder?: number;
  isPublished?: boolean;
}

/** Raw DB row shape (snake_case) */
export interface ProductionCategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sub_types: string[];
  cover_image_url: string | null;
  cover_image_public_id: string | null;
  starting_rate: number;
  starting_unit: string;
  project_type: string;
  creator_keywords: string[];
  icon: string | null;
  display_order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

/** Convert DB row → client-friendly ProductionCategory */
export function toProductionCategory(row: ProductionCategoryRow): ProductionCategory {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? '',
    subTypes: row.sub_types ?? [],
    startingRate: row.starting_rate,
    startingUnit: row.starting_unit as ProductionCategory['startingUnit'],
    projectType: row.project_type,
    creatorKeywords: row.creator_keywords ?? [],
    coverImageUrl: row.cover_image_url,
    coverImagePublicId: row.cover_image_public_id,
    icon: row.icon,
    displayOrder: row.display_order,
    isPublished: row.is_published,
  };
}

export interface ProductionPackageService {
  type: 'photography' | 'cinematography' | 'postProduction';
  subType: string;
  hours: number;
}

export interface ProductionPackage {
  id: string;
  name: string;
  description: string;
  /** Matches ProductionCategory.slug */
  category: string;
  services: ProductionPackageService[];
  deliverables: string[];
  popular?: boolean;
}

export interface PackagePriceResult {
  subtotal: number;
  vat: number;
  total: number;
  lineItems: {
    service: string;
    hours: number;
    rate: number;
    amount: number;
  }[];
}
