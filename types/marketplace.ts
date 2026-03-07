// ─── Listing types ──────────────────────────────────────────────────────────

export type ListingType = 'gear' | 'service';
export type PricingModel = 'fixed' | 'hourly' | 'daily' | 'weekly' | 'monthly';
export type ListingCondition = 'new' | 'like-new' | 'good' | 'fair' | 'poor';

// ─── DB row type ────────────────────────────────────────────────────────────

export type Listing = {
  id: string;
  user_id: string;
  type: ListingType;
  title: string;
  slug: string;
  description: string | null;
  price: number;
  pricing_model: PricingModel;
  currency: string;
  category: string | null;
  sub_category: string | null;
  thumbnail_url: string | null;
  cover_public_id: string | null;
  gallery: { url: string; public_id: string }[] | null;
  location: string | null;
  condition: ListingCondition | null;
  is_published: boolean;
  is_featured: boolean;
  tags: string[] | null;
  features: string[] | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

// ─── Input types for mutations ──────────────────────────────────────────────

export type CreateListingInput = {
  user_id: string;
  type: ListingType;
  title: string;
  slug: string;
  description?: string;
  price: number;
  pricing_model: PricingModel;
  currency?: string;
  category?: string;
  sub_category?: string;
  thumbnail_url?: string;
  cover_public_id?: string;
  gallery?: { url: string; public_id: string }[];
  location?: string;
  condition?: ListingCondition;
  tags?: string[];
  features?: string[];
};
