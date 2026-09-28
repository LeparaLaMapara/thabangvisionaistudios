import { createAdminClient } from '@/lib/supabase/server';
import { itemValue } from '@/lib/rental/protection';

type Admin = ReturnType<typeof createAdminClient>;

/**
 * A renter's record, for the trust ladder: hires returned without a dispute,
 * and the value of gear they already have paid for and not yet returned.
 */
export async function loadRenterRecord(admin: Admin, userId: string): Promise<{ cleanReturns: number; alreadyOut: number }> {
  const [{ count: clean }, { data: out }] = await Promise.all([
    admin
      .from('equipment_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'completed')
      .is('dispute_reason', null),
    admin
      .from('equipment_bookings')
      .select('quantity, smart_rentals(replacement_value, deposit_amount)')
      .eq('user_id', userId)
      .in('status', ['confirmed', 'active', 'overdue']),
  ]);

  const alreadyOut = (out ?? []).reduce((sum, row) => {
    const r = row as { quantity: number | null; smart_rentals: unknown };
    const rental = (Array.isArray(r.smart_rentals) ? r.smart_rentals[0] : r.smart_rentals) as
      | { replacement_value?: number | null; deposit_amount?: number | null }
      | null;
    return sum + (rental ? itemValue(rental) * (r.quantity ?? 1) : 0);
  }, 0);

  return { cleanReturns: clean ?? 0, alreadyOut };
}
