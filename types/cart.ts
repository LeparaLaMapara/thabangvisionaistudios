export interface CartItem {
  id: string;
  user_id: string;
  rental_id: string;
  quantity: number;
  created_at: string;
}

export interface CartItemWithRental extends CartItem {
  rental: {
    id: string;
    title: string;
    slug: string;
    category: string;
    brand: string | null;
    price_per_day: number;
    price_per_week: number | null;
    deposit_amount: number;
    currency: string;
    is_available: boolean;
    thumbnail_url: string | null;
  };
}

export interface BulkDiscountTier {
  minItems: number;
  maxItems: number;
  discountPercent: number;
}

export interface CartPricingItem {
  rental_id: string;
  title: string;
  quantity: number;
  days: number;
  unitPrice: number;
  subtotal: number;
  deposit: number;
}

export interface CartPricingSummary {
  items: CartPricingItem[];
  itemCount: number;
  dayCount: number;
  subtotal: number;
  bulkDiscountPercent: number;
  bulkDiscountAmount: number;
  totalDeposit: number;
  grandTotal: number;
}
