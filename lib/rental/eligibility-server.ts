import { createAdminClient } from '@/lib/supabase/server';
import { RENTAL_POLICY } from '@/lib/constants';
import { toCents } from '@/lib/core/pricing/money';
import { checkEligibility, type EligibilityResult, type HoldingForTrust, type OrderLineForTrust, type RenterFacts } from '@/lib/core/rental/trust';
import { EXPOSURE_STATUSES } from '@/lib/core/rental/state';
import { itemValue } from '@/lib/rental/protection';
import { sastDate } from '@/lib/core/rental/notifications';

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Loads the facts the trust policy needs, from the database, with the
 * service role. Nothing here comes from the browser. Only counts and totals
 * leave this function: no other customer's data.
 */

interface BookingFactRow {
  id: string;
  status: string;
  quantity: number | null;
  late_fee: number | null;
  dispute_reason: string | null;
  inspection_outcome: string | null;
  completed_at: string | null;
  returned_at: string | null;
  updated_at: string;
  hold_expires_at: string | null;
  start_date: string | null;
  end_date: string | null;
  unit_replacement_value_cents: number | null;
  smart_rentals: unknown;
}

function unitValueCents(row: BookingFactRow): number {
  if (row.unit_replacement_value_cents != null) return Number(row.unit_replacement_value_cents);
  const rental = (Array.isArray(row.smart_rentals) ? row.smart_rentals[0] : row.smart_rentals) as
    | { replacement_value?: number | null; deposit_amount?: number | null }
    | null;
  return rental ? toCents(itemValue(rental)) : 0;
}

/**
 * A booking the renter holds, with the dates it keeps gear out. Gear that is
 * overdue, being inspected, disputed, or still out past its end date is held
 * until it is settled (open end), as availability treats it.
 */
function holdingOf(r: BookingFactRow, valueCents: number, now: Date): HoldingForTrust {
  const openEnded =
    ['overdue', 'return_pending', 'return_reviewed', 'disputed'].includes(r.status) ||
    (r.status === 'active' && r.end_date != null && r.end_date < sastDate(now));
  return { startDate: r.start_date, endDate: openEnded ? null : r.end_date, valueCents };
}

export async function loadRenterFacts(
  admin: Admin,
  user: { id: string; email_confirmed_at?: string | null },
  now: Date = new Date(),
): Promise<{ facts: RenterFacts; exposureCents: number; holdings: HoldingForTrust[] }> {
  const BASE = 'id, status, quantity, late_fee, dispute_reason, completed_at, returned_at, updated_at, start_date, end_date, smart_rentals(replacement_value, deposit_amount)';
  const PIPELINE = ', inspection_outcome, hold_expires_at, unit_replacement_value_cents';
  const bookingsQuery = (cols: string) => admin.from('equipment_bookings').select(cols).eq('user_id', user.id);
  const [profileRes, bankRes, first] = await Promise.all([
    admin.from('profiles').select('phone_verified_at, verification_status, verification_fraud_flags, is_suspended').eq('id', user.id).maybeSingle(),
    admin.from('banking_details').select('is_verified').eq('user_id', user.id).maybeSingle(),
    bookingsQuery(BASE + PIPELINE),
  ]);
  // Migration 070 not applied yet: the pipeline columns do not exist.
  const bookingsRes = first.error ? await bookingsQuery(BASE) : first;
  if (profileRes.error || bookingsRes.error) {
    throw new Error('could not load renter record');
  }

  const profile = (profileRes.data ?? {}) as {
    phone_verified_at?: string | null;
    verification_status?: string | null;
    verification_fraud_flags?: unknown;
    is_suspended?: boolean | null;
  };
  const rows = (bookingsRes.data ?? []) as unknown as BookingFactRow[];

  const sixMonthsAgo = now.getTime() - 180 * 86_400_000;
  let cleanReturns = 0;
  let cleanReturnValueCents = 0;
  let firstClean: number | null = null;
  const disputedBookings = new Set<string>();
  let overdueNow = 0;
  let recentLateReturns = 0;
  let exposureCents = 0;
  const holdings: HoldingForTrust[] = [];

  for (const r of rows) {
    const qty = Math.max(1, r.quantity ?? 1);
    const late = Number(r.late_fee ?? 0) > 0 || r.inspection_outcome === 'late';
    if (r.status === 'completed') {
      const at = new Date(r.completed_at ?? r.returned_at ?? r.updated_at).getTime();
      const clean = !r.dispute_reason && !late && (r.inspection_outcome === null || r.inspection_outcome === undefined || r.inspection_outcome === 'clean');
      if (clean) {
        cleanReturns += 1;
        cleanReturnValueCents += unitValueCents(r) * qty;
        if (!Number.isNaN(at)) firstClean = firstClean === null ? at : Math.min(firstClean, at);
      }
      if (late && at >= sixMonthsAgo) recentLateReturns += 1;
    }
    if (r.status === 'disputed') disputedBookings.add(r.id);
    if (r.status === 'overdue') overdueNow += 1;

    const holding =
      (EXPOSURE_STATUSES as readonly string[]).includes(r.status) ||
      (r.status === 'pending' && r.hold_expires_at != null && new Date(r.hold_expires_at).getTime() > now.getTime());
    if (holding) {
      const value = unitValueCents(r) * qty;
      exposureCents += value;
      holdings.push(holdingOf(r, value, now));
    }
  }

  // Open dispute records count too. A dispute on a hire that is still out, or
  // already completed, leaves the booking's status alone (app/api/disputes).
  const bookingIds = rows.map((r) => r.id);
  if (bookingIds.length > 0) {
    const { data: open, error: dErr } = await admin
      .from('disputes')
      .select('equipment_booking_id')
      .in('equipment_booking_id', bookingIds)
      .in('status', ['open', 'investigating', 'escalated']);
    if (dErr) throw new Error('could not load renter disputes');
    for (const d of (open ?? []) as { equipment_booking_id: string | null }[]) {
      if (d.equipment_booking_id) disputedBookings.add(d.equipment_booking_id);
    }
  }
  const openDisputes = disputedBookings.size;

  // Overdue past formal escalation (+48h) pauses new bookings.
  let overdueEscalated = 0;
  if (overdueNow > 0) {
    const { count, error } = await admin
      .from('rental_escalations')
      .select('id, equipment_bookings!inner(user_id, status)', { count: 'exact', head: true })
      .in('stage', ['formal_escalation', 'senior_review'])
      .eq('equipment_bookings.user_id', user.id)
      .eq('equipment_bookings.status', 'overdue');
    overdueEscalated = error ? 0 : count ?? 0;
  }

  const flags = Array.isArray(profile.verification_fraud_flags) ? profile.verification_fraud_flags.length : 0;

  return {
    facts: {
      emailVerified: Boolean(user.email_confirmed_at),
      phoneVerified: Boolean(profile.phone_verified_at),
      identityApproved: profile.verification_status === 'verified',
      bankValidated: (bankRes.data as { is_verified?: boolean } | null)?.is_verified === true,
      cleanReturns,
      cleanReturnValueCents,
      firstCleanReturnAt: firstClean === null ? null : new Date(firstClean).toISOString(),
      openDisputes,
      overdueNow,
      overdueEscalated,
      recentLateReturns,
      fraudFlags: flags,
      suspended: profile.is_suspended === true,
      manualReview: false,
    },
    exposureCents,
    holdings,
  };
}

/** The full server-side eligibility check for an order. */
export async function checkRenterEligibility(
  admin: Admin,
  user: { id: string; email_confirmed_at?: string | null },
  lines: OrderLineForTrust[],
  delivery: boolean,
  now: Date = new Date(),
): Promise<EligibilityResult> {
  const { facts, exposureCents, holdings } = await loadRenterFacts(admin, user, now);
  return checkEligibility({
    facts,
    currentExposureCents: exposureCents,
    // Peak held at once: each new line against the bookings on its own dates.
    holdings,
    lines,
    delivery,
    policy: {
      highValueCollectionThresholdCents: RENTAL_POLICY.highValueCollectionThresholdCents,
      firstHireCollectionOnly: RENTAL_POLICY.firstHireCollectionOnly,
    },
    now,
  });
}
