import { createAdminClient } from '@/lib/supabase/server';
import { checkAvailability, type AvailabilityResult, type BookingHold } from '@/lib/rental/availability';
import { payments } from '@/lib/payments';
import { STUDIO } from '@/lib/constants';

/** While online payment is off, a saved request keeps its dates this long, so the team can call and arrange payment. */
export const OFFLINE_HOLD_MINUTES = 48 * 60;

/** How long an unpaid gear request holds its dates. Short when people can pay online at once; long while payment is arranged by hand. */
export function effectiveHoldMinutes(): number {
  return payments.isConfigured() ? STUDIO.rental.pendingHoldMinutes : OFFLINE_HOLD_MINUTES;
}

/**
 * Every booking that holds this item over these dates, whoever made it.
 *
 * This must read with the server key. Customers may only read their own
 * bookings (row level security), so a check run under the customer's login
 * saw none of anyone else's and would have let two people book the same
 * camera for the same days. Only counts leave this function, never people.
 */
export async function loadHolds(rentalId: string, startDate: string, endDate: string): Promise<BookingHold[]> {
  const { data, error } = await createAdminClient()
    .from('equipment_bookings')
    .select('id, quantity, status, created_at, payfast_payment_id, payment_method')
    .eq('rental_id', rentalId)
    .in('status', ['pending', 'confirmed', 'active', 'overdue'])
    .lt('start_date', endDate)
    .gt('end_date', startDate);
  // Never treat an unreadable check as "available": that sells gear twice.
  if (error) throw new Error(`availability check failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    quantity: row.quantity ?? 1,
    status: row.status,
    createdAt: row.created_at,
    paymentReference: row.payfast_payment_id,
    method: row.payment_method,
  }));
}

export async function availabilityFor(params: {
  rentalId: string;
  stock: number | null | undefined;
  startDate: string;
  endDate: string;
  requested?: number;
}): Promise<AvailabilityResult> {
  const holds = await loadHolds(params.rentalId, params.startDate, params.endDate);
  return checkAvailability({ stock: params.stock ?? 1, holds, requested: params.requested ?? 1, holdMinutes: effectiveHoldMinutes() });
}
