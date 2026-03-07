// ─── Marketplace enums ───────────────────────────────────────────────────────

export type ListingType = 'gear' | 'service';
export type PricingModel = 'fixed' | 'hourly' | 'daily' | 'weekly' | 'monthly';
export type ListingCondition = 'new' | 'like-new' | 'good' | 'fair' | 'poor';

export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'refunded';

export type SubscriptionStatus = 'active' | 'past_due' | 'cancelled' | 'expired';

// ─── DB row types ────────────────────────────────────────────────────────────

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

export type Order = {
  id: string;
  buyer_id: string;
  seller_id: string;
  listing_id: string;
  status: OrderStatus;
  total: number;
  platform_fee: number;
  seller_payout: number;
  currency: string;
  payfast_payment_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Review = {
  id: string;
  order_id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
};

export type SubscriptionPlan = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  currency: string;
  interval: 'month' | 'year';
  features: Record<string, unknown>[] | null;
  payfast_plan_id: string | null;
  is_active: boolean;
  created_at: string;
};

export type Subscription = {
  id: string;
  user_id: string;
  plan_id: string;
  payfast_token: string | null;
  status: SubscriptionStatus;
  current_period_start: string;
  current_period_end: string;
  created_at: string;
  updated_at: string;
};

// ─── Input types for mutations ───────────────────────────────────────────────

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

export type CreateOrderInput = {
  buyer_id: string;
  seller_id: string;
  listing_id: string;
  total: number;
  platform_fee: number;
  seller_payout: number;
  currency: string;
  notes?: string;
};

export type CreateReviewInput = {
  order_id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: number;
  comment?: string;
};
