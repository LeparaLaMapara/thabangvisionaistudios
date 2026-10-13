import { createAdminClient } from '@/lib/supabase/server';
import { checkAvailability, overlapsRange, type AvailabilityResult, type BookingHold } from '@/lib/rental/availability';
import { INVENTORY_BLOCKING_STATUSES } from '@/lib/core/rental/state';
import { sastDate } from '@/lib/core/rental/notifications';
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
  const db = createAdminClient();
  const BASE = 'id, quantity, status, created_at, start_date, end_date, payfast_payment_id, payment_method';
  // Everything that started on or before the requested end; whether it still
  // reaches the requested start is decided below (gear not back has no end).
  const query = (cols: string) =>
    db.from('equipment_bookings').select(cols).eq('rental_id', rentalId).in('status', [...INVENTORY_BLOCKING_STATUSES]).lte('start_date', endDate);
  let res = await query(`${BASE}, hold_expires_at`);
  // Migration 070 not applied yet: no hold_expires_at column.
  if (res.error) res = await query(BASE);
  // Never treat an unreadable check as "available": that sells gear twice.
  if (res.error) throw new Error(`availability check failed: ${res.error.message}`);
  const today = sastDate(new Date());
  const rows = (res.data ?? []) as unknown as {
    id: string; quantity: number | null; status: string; created_at: string; start_date: string; end_date: string;
    payfast_payment_id: string | null; payment_method: string | null; hold_expires_at?: string | null;
  }[];
  return rows
    .filter((row) => overlapsRange(row, startDate, endDate, today))
    .map((row) => ({
      id: row.id,
      quantity: row.quantity ?? 1,
      status: row.status,
      createdAt: row.created_at,
      paymentReference: row.payfast_payment_id,
      method: row.payment_method,
      holdExpiresAt: row.hold_expires_at ?? null,
    }));
}

/** Units taken off sale by maintenance or repair blocks (070). Zero if the table does not exist yet. */
export async function blockedUnits(rentalId: string, startDate: string, endDate: string): Promise<number> {
  const { data, error } = await createAdminClient()
    .from('rental_blocks')
    .select('units, starts_on, ends_on')
    .eq('rental_id', rentalId)
    .is('lifted_at', null)
    .lte('starts_on', endDate);
  if (error) return 0;
  return ((data ?? []) as { units: number; ends_on: string | null }[])
    .filter((b) => b.ends_on === null || b.ends_on >= startDate)
    .reduce((sum, b) => sum + (b.units ?? 1), 0);
}

export async function availabilityFor(params: {
  rentalId: string;
  stock: number | null | undefined;
  startDate: string;
  endDate: string;
  requested?: number;
}): Promise<AvailabilityResult> {
  const [holds, blocked] = await Promise.all([
    loadHolds(params.rentalId, params.startDate, params.endDate),
    blockedUnits(params.rentalId, params.startDate, params.endDate),
  ]);
  // Units off sale for maintenance count as taken.
  if (blocked > 0) holds.push({ id: 'rental_blocks', quantity: blocked, status: 'confirmed', createdAt: new Date(0).toISOString(), paymentReference: null });
  return checkAvailability({ stock: params.stock ?? 1, holds, requested: params.requested ?? 1, holdMinutes: effectiveHoldMinutes() });
}
