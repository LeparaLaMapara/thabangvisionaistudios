import { createClient } from '@/lib/supabase/server';
import type {
  EquipmentBooking,
  BookingPayment,
  Invoice,
  BookingStatus,
  CreateBookingInput,
  UpdateBookingStatusInput,
} from '@/types/booking';

// Re-export types for convenience
export type { EquipmentBooking, BookingPayment, Invoice, BookingStatus };

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Returns all bookings for a given user, ordered by start_date DESC.
 */
export async function getBookingsByUser(userId: string): Promise<EquipmentBooking[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('equipment_bookings')
    .select('*')
    .eq('user_id', userId)
    .order('start_date', { ascending: false });

  if (error) {
    console.error('[getBookingsByUser]', error.message);
    return [];
  }

  return (data as EquipmentBooking[]) ?? [];
}

/**
 * Returns a single booking by id, or null if not found.
 * PGRST116 = "no rows" — treated as a normal 404, not an error.
 */
export async function getBookingById(id: string): Promise<EquipmentBooking | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('equipment_bookings')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[getBookingById]', error.message);
    }
    return null;
  }

  return data as EquipmentBooking;
}

/**
 * Returns all bookings for a specific rental item within a date range.
 * Used for availability checking / double-booking prevention.
 */
export async function getBookingsForRental(
  rentalId: string,
  startDate: string,
  endDate: string,
): Promise<EquipmentBooking[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('equipment_bookings')
    .select('*')
    .eq('rental_id', rentalId)
    .in('status', ['pending', 'confirmed', 'active'])
    .lt('start_date', endDate)
    .gt('end_date', startDate);

  if (error) {
    console.error('[getBookingsForRental]', error.message);
    return [];
  }

  return (data as EquipmentBooking[]) ?? [];
}

/**
 * Checks if a rental item is available for the given date range.
 */
export async function isRentalAvailable(
  rentalId: string,
  startDate: string,
  endDate: string,
): Promise<boolean> {
  const conflicts = await getBookingsForRental(rentalId, startDate, endDate);
  return conflicts.length === 0;
}

/**
 * Returns payments for a booking, ordered by created_at DESC.
 */
export async function getPaymentsByBooking(bookingId: string): Promise<BookingPayment[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('booking_payments')
    .select('*')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getPaymentsByBooking]', error.message);
    return [];
  }

  return (data as BookingPayment[]) ?? [];
}

/**
 * Returns the invoice for a booking, or null if not found.
 */
export async function getInvoiceByBooking(bookingId: string): Promise<Invoice | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('booking_id', bookingId)
    .single();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[getInvoiceByBooking]', error.message);
    }
    return null;
  }

  return data as Invoice;
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Creates a new booking with status 'pending'.
 */
export async function createBooking(
  input: CreateBookingInput,
): Promise<EquipmentBooking | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('equipment_bookings')
    .insert({ ...input, status: 'pending' as BookingStatus })
    .select()
    .single();

  if (error) {
    console.error('[createBooking]', error.message);
    return null;
  }

  return data as EquipmentBooking;
}

/**
 * Updates a booking's status and optionally sets payfast_payment_id or cancelled_at.
 */
export async function updateBookingStatus(
  bookingId: string,
  input: UpdateBookingStatusInput,
): Promise<EquipmentBooking | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('equipment_bookings')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', bookingId)
    .select()
    .single();

  if (error) {
    console.error('[updateBookingStatus]', error.message);
    return null;
  }

  return data as EquipmentBooking;
}

/**
 * Creates a payment record for a booking.
 */
export async function createBookingPayment(
  bookingId: string,
  payfastPaymentId: string,
  amount: number,
  currency: string,
): Promise<BookingPayment | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('booking_payments')
    .insert({
      booking_id: bookingId,
      payfast_payment_id: payfastPaymentId,
      amount,
      currency,
      status: 'pending',
    })
    .select()
    .single();

  if (error) {
    console.error('[createBookingPayment]', error.message);
    return null;
  }

  return data as BookingPayment;
}

/**
 * Creates an invoice for a booking.
 */
export async function createInvoice(
  bookingId: string,
  invoiceNumber: string,
  amount: number,
  currency: string,
): Promise<Invoice | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('invoices')
    .insert({
      booking_id: bookingId,
      invoice_number: invoiceNumber,
      amount,
      currency,
      status: 'draft',
    })
    .select()
    .single();

  if (error) {
    console.error('[createInvoice]', error.message);
    return null;
  }

  return data as Invoice;
}
