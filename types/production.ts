// ─── Production Categories & Packages ────────────────────────────────────────
// Types for the Smart Productions service catalogue.
// Categories and packages are defined in lib/constants.ts.

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
