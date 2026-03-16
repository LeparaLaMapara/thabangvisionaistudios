// ─── Order status ────────────────────────────────────────────────────────────

export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'refunded';

// ─── DB row type ────────────────────────────────────────────────────────────

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

// ─── Joined view returned by the dashboard query ────────────────────────────

export type OrderWithListing = Order & {
  listing_title: string | null;
  listing_thumbnail: string | null;
};
