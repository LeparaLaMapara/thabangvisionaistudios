export interface CartItem {
  id: string;
  user_id: string;
  rental_id: string;
  quantity: number;
  start_date: string | null;
  end_date: string | null;
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
    /** Units of this listing in stock. Availability counts units, not bookings. */
    quantity: number | null;
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
  /** VAT rate applied, as a percentage. */
  vatRate: number;
  /** VAT already contained in the discounted hire charge. Not added to grandTotal. */
  vatAmount: number;
  grandTotal: number;
}

export interface CartPerItemPricingSummary {
  items: CartPricingItem[];
  itemCount: number;
  subtotal: number;
  bulkDiscountPercent: number;
  bulkDiscountAmount: number;
  totalDeposit: number;
  /** VAT rate applied, as a percentage. */
  vatRate: number;
  /** VAT already contained in the discounted hire charge. Not added to grandTotal. */
  vatAmount: number;
  grandTotal: number;
}
