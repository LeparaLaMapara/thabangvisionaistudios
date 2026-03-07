// ─── Booking status enums ────────────────────────────────────────────────────

export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'active'
  | 'completed'
  | 'cancelled';

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'refunded';

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void';

// ─── DB row types ────────────────────────────────────────────────────────────

export type EquipmentBooking = {
  id: string;
  user_id: string;
  rental_id: string;
  start_date: string;
  end_date: string;
  total_price: number;
  deposit_amount: number;
  currency: string;
  status: BookingStatus;
  notes: string | null;
  payfast_payment_id: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
};

export type BookingPayment = {
  id: string;
  booking_id: string;
  payfast_payment_id: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  created_at: string;
};

export type Invoice = {
  id: string;
  booking_id: string;
  invoice_number: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  pdf_url: string | null;
  created_at: string;
};

// ─── Input types for mutations ───────────────────────────────────────────────

export type CreateBookingInput = {
  user_id: string;
  rental_id: string;
  start_date: string;
  end_date: string;
  total_price: number;
  deposit_amount: number;
  currency: string;
  notes?: string;
};

export type UpdateBookingStatusInput = {
  status: BookingStatus;
  payfast_payment_id?: string;
  cancelled_at?: string;
};
