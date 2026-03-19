export type BookingStatus = 'pending' | 'paid' | 'accepted' | 'completed' | 'paid_out' | 'cancelled' | 'disputed';
export type PaymentStatus = 'unpaid' | 'paid' | 'refunded';
export type PayoutStatus = 'pending' | 'processing' | 'paid' | 'failed';
export type BookingType = 'production' | 'rental' | 'crew';

export interface Booking {
  id: string;
  reference: string;
  client_id: string;
  client_email: string;
  creator_id: string | null;
  booking_type: BookingType;
  project_category: string;
  project_description: string;
  deliverables: string;
  duration_hours: number;
  location: string | null;
  preferred_dates: string | null;
  subtotal: number;
  vat: number;
  total: number;
  platform_commission: number;
  platform_amount: number;
  creator_amount: number;
  paystack_fee_estimate: number | null;
  payment_status: PaymentStatus;
  paystack_reference: string | null;
  paystack_access_code: string | null;
  paid_at: string | null;
  payout_status: PayoutStatus;
  payout_reference: string | null;
  paid_out_at: string | null;
  status: BookingStatus;
  client_rating: number | null;
  client_review: string | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
}

export interface BookingWithCreator extends Booking {
  creator: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    crew_slug: string | null;
  } | null;
}

export interface BookingWithClient extends Booking {
  client: {
    display_name: string;
  } | null;
}
