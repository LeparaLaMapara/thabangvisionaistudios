// ─── Ubunye AI Studio Types ─────────────────────────────────────────────────

export type QuickAction = {
  id: string;
  label: string;
  description: string;
  icon: string;
  prompt: string;
};

export type GearSummary = {
  id: string;
  slug: string;
  title: string;
  category: string;
  brand: string | null;
  thumbnail_url: string | null;
  price_per_day: number | null;
  is_available: boolean;
};

export type CreatorSummary = {
  id: string;
  display_name: string | null;
  crew_slug: string | null;
  avatar_url: string | null;
  specializations: string[];
  hourly_rate: number | null;
  location: string | null;
};

export type ProductionSummary = {
  id: string;
  slug: string;
  title: string;
  project_type: string;
  client: string | null;
  thumbnail_url: string | null;
};

export type StudioContext = {
  featuredGear: GearSummary[];
  featuredCreators: CreatorSummary[];
  featuredProductions: ProductionSummary[];
};
