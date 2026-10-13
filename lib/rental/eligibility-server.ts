import { createAdminClient } from '@/lib/supabase/server';
import { RENTAL_POLICY } from '@/lib/constants';
import { toCents } from '@/lib/core/pricing/money';
import { formatRand } from '@/lib/format/money';
import {
  TRUST_TIERS,
  checkEligibility,
  collectionReasons,
  earnedTier,
  peakExposure,
  type EligibilityResult,
  type HoldingForTrust,
  type OrderLineForTrust,
  type RenterFacts,
  type TrustRequirementCode,
  type TrustTierId,
} from '@/lib/core/rental/trust';
import { EXPOSURE_STATUSES } from '@/lib/core/rental/state';
import { itemValue } from '@/lib/rental/protection';
import { sastDate } from '@/lib/core/rental/notifications';

type Admin = ReturnType<typeof createAdminClient>;

const COLLECTION_POLICY = {
  highValueCollectionThresholdCents: RENTAL_POLICY.highValueCollectionThresholdCents,
  firstHireCollectionOnly: RENTAL_POLICY.firstHireCollectionOnly,
};

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
  checkout_group_id: string | null;
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
  opts: { excludeGroupId?: string } = {},
): Promise<{ facts: RenterFacts; exposureCents: number; holdings: HoldingForTrust[]; verificationStatus: string | null }> {
  const BASE = 'id, status, quantity, late_fee, dispute_reason, completed_at, returned_at, updated_at, start_date, end_date, checkout_group_id, smart_rentals(replacement_value, deposit_amount)';
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
    // The order being checked is the "new" one: its own lines are not already-held gear.
    if (holding && !(opts.excludeGroupId && r.checkout_group_id === opts.excludeGroupId)) {
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
    verificationStatus: profile.verification_status ?? null,
  };
}

/** The full server-side eligibility check for an order. */
export async function checkRenterEligibility(
  admin: Admin,
  user: { id: string; email_confirmed_at?: string | null },
  lines: OrderLineForTrust[],
  delivery: boolean,
  now: Date = new Date(),
  opts: { excludeGroupId?: string } = {},
): Promise<EligibilityResult> {
  const { facts, exposureCents, holdings } = await loadRenterFacts(admin, user, now, opts);
  return checkEligibility({
    facts,
    currentExposureCents: exposureCents,
    // Peak held at once: each new line against the bookings on its own dates.
    holdings,
    lines,
    delivery,
    policy: COLLECTION_POLICY,
    now,
  });
}

/**
 * Before an order paid after its hold lapsed is reinstated: would the renter
 * be within their limit (and free of account holds) with it back? Read with
 * the service role. Throws if it cannot tell, so the payment is retried.
 */
export async function lateConfirmationAllowed(
  admin: Admin,
  intent: { userId: string; checkoutGroupId: string },
  now: Date = new Date(),
): Promise<boolean> {
  const [{ data: lines, error: linesErr }, { data: userRes, error: userErr }] = await Promise.all([
    admin
      .from('equipment_bookings')
      .select('quantity, start_date, end_date, unit_replacement_value_cents, smart_rentals(replacement_value, deposit_amount)')
      .eq('checkout_group_id', intent.checkoutGroupId),
    admin.auth.admin.getUserById(intent.userId),
  ]);
  if (linesErr || userErr || !userRes?.user) throw new Error('late payment: could not load the order or renter');
  const order: OrderLineForTrust[] = ((lines ?? []) as unknown as BookingFactRow[]).map((r) => ({
    unitReplacementValueCents: unitValueCents(r),
    quantity: Math.max(1, r.quantity ?? 1),
    startDate: r.start_date ?? undefined,
    endDate: r.end_date ?? undefined,
  }));
  const result = await checkRenterEligibility(
    admin,
    { id: intent.userId, email_confirmed_at: userRes.user.email_confirmed_at ?? null },
    order,
    false,
    now,
    { excludeGroupId: intent.checkoutGroupId },
  );
  return result.ok;
}

// ─── Readiness: everything a renter needs, before they pay (spec §9) ─────────

/**
 * What a renter still needs before this order can be paid for, worked out
 * from the same facts and rules the checkout enforces, so the gear page and
 * the cart can show it up front instead of a refusal after the form.
 * Read-only: the checkout still checks everything itself.
 */
export type ReadinessCode = TrustRequirementCode | 'trust_limit' | 'account_hold';
export type ReadinessStatus = 'done' | 'missing' | 'pending' | 'unavailable';

export interface ReadinessItem {
  code: ReadinessCode;
  label: string;
  /** Where it is fixed, or null when there is nothing to open. */
  href: string | null;
  status: ReadinessStatus;
  detail?: string;
}

export type ReadinessBlock = 'ID_REQUIRED' | 'ID_PENDING' | 'not_eligible' | 'trust_limit' | 'collection_only' | 'account_hold';

export interface RentalReadiness {
  /** Nothing missing: the checkout should accept this order (it still checks). */
  ok: boolean;
  /** The first reason the checkout would refuse, as it reports it; null when ok. */
  code: ReadinessBlock | null;
  message: string | null;
  tier: TrustTierId;
  limitCents: number;
  /** Every requirement that applies to this order, done or not. */
  checklist: ReadinessItem[];
  /** The ones not done yet. */
  missing: ReadinessItem[];
  collectionRequired: boolean;
  /** first_hire, high_value_item: why delivery cannot be offered. */
  collectionReasons: string[];
  /** A person approves the booking before handover. */
  requiresManualApproval: boolean;
  /** Whether phone checks can be done online right now (SMS configured). */
  phoneChecksAvailable: boolean;
}

/** Where each requirement is fixed. */
export const REQUIREMENT_LINKS: Record<ReadinessCode, string | null> = {
  verify_email: null,
  verify_phone: '/dashboard/profile#phone',
  verify_id: '/dashboard/verification',
  validate_bank: '/dashboard/banking',
  clean_returns: null,
  history_days: null,
  clean_return_value: null,
  trust_limit: '/contact',
  account_hold: '/contact',
};

const zar = (cents: number): string => formatRand(Math.round(cents / 100));
const rank = (id: TrustTierId): number => TRUST_TIERS.findIndex((t) => t.id === id);

/** Pure: the checklist for an order from the renter's facts. */
export function buildReadiness(input: {
  facts: RenterFacts;
  verificationStatus: string | null;
  holdings: readonly HoldingForTrust[];
  lines: readonly OrderLineForTrust[];
  delivery: boolean;
  now: Date;
  phoneChecksAvailable: boolean;
}): RentalReadiness {
  const { facts, holdings, lines, delivery, now } = input;
  const result = checkEligibility({ facts, currentExposureCents: 0, holdings, lines, delivery, policy: COLLECTION_POLICY, now });
  const reasons = collectionReasons(facts, lines, COLLECTION_POLICY);
  const peak = peakExposure(holdings, lines);
  const total = peak.currentCents + peak.orderCents;
  // The smallest limit that covers this order with what is already held then.
  const needed = TRUST_TIERS.find((t) => t.id !== 'none' && t.maxExposureCents >= total) ?? null;

  const item = (code: ReadinessCode, label: string, status: ReadinessStatus, detail?: string): ReadinessItem => ({
    code,
    label,
    href: status === 'done' ? null : REQUIREMENT_LINKS[code],
    status,
    ...(detail ? { detail } : {}),
  });

  const checklist: ReadinessItem[] = [];
  checklist.push(
    facts.emailVerified
      ? item('verify_email', 'Email address confirmed', 'done')
      : item('verify_email', 'Confirm your email address', 'missing', 'Open the confirmation link we emailed you when you signed up.'),
  );
  checklist.push(
    facts.phoneVerified
      ? item('verify_phone', 'Phone number confirmed', 'done')
      : input.phoneChecksAvailable
        ? item('verify_phone', 'Confirm your phone number by SMS', 'missing')
        : {
            ...item('verify_phone', 'Confirm your phone number', 'unavailable', 'Phone checks are not available online yet. Contact us and we will help you.'),
            href: '/contact',
          },
  );
  const idStatus = input.verificationStatus;
  checklist.push(
    facts.identityApproved
      ? item('verify_id', 'ID check approved', 'done')
      : idStatus === 'pending'
        ? item('verify_id', 'ID check sent, waiting for review', 'pending', 'A person reviews it. Do the other steps meanwhile; you pay once it is approved.')
        : item('verify_id', idStatus === 'rejected' ? 'Do the ID check again (ID and selfie)' : 'One-time ID check (ID and selfie)', 'missing'),
  );

  // A bank account in the renter's own name is asked for only when this
  // order needs the higher limit it unlocks.
  const needsVerifiedTier = needed === null || rank(needed.id) >= rank('verified');
  if (needsVerifiedTier) {
    checklist.push(
      facts.bankValidated
        ? item('validate_bank', 'Bank account in your name checked', 'done')
        : item('validate_bank', 'Add a bank account in your own name', 'missing', `Needed for more than ${zar(RENTAL_POLICY.trustTierLimitsCents.contactable)} of gear at a time.`),
    );
  }

  // Beyond what the steps above can unlock, only rental history or a person raises the limit.
  const afterSteps = earnedTier({ ...facts, emailVerified: true, phoneVerified: true, identityApproved: true, bankValidated: true }, now);
  if (needed === null) {
    const top = TRUST_TIERS[TRUST_TIERS.length - 1];
    checklist.push(item('trust_limit', `This hire is above the largest limit (${zar(top.maxExposureCents)} of gear at a time)`, 'missing', 'Contact us to arrange it.'));
  } else if (rank(afterSteps.tier.id) < rank(needed.id)) {
    const how = afterSteps.next ? `It rises when you ${afterSteps.next.missing.join(' and ')}. ` : '';
    checklist.push(
      item(
        'trust_limit',
        `This hire needs a ${zar(needed.maxExposureCents)} limit; yours can reach ${zar(afterSteps.tier.maxExposureCents)} of gear at a time`,
        'missing',
        `${how}Choose fewer items or other dates, or contact us for a larger hire.`,
      ),
    );
  }
  if (!result.ok && result.code === 'account_hold') {
    checklist.push(item('account_hold', result.message, 'missing'));
  }

  // The checkout checks identity first, then the trust rules: report in that order.
  let code: ReadinessBlock | null = null;
  let message: string | null = null;
  if (!facts.identityApproved) {
    code = idStatus === 'pending' ? 'ID_PENDING' : 'ID_REQUIRED';
    message = idStatus === 'pending' ? 'Your ID check is being reviewed. You can pay once it is approved.' : 'Identity verification is required to rent equipment.';
  } else if (!result.ok) {
    code = result.code;
    message = result.message;
  }

  return {
    ok: code === null,
    code,
    message,
    tier: result.assessment.tier.id,
    limitCents: result.assessment.tier.maxExposureCents,
    checklist,
    missing: checklist.filter((i) => i.status !== 'done'),
    collectionRequired: reasons.length > 0,
    collectionReasons: reasons,
    requiresManualApproval: result.assessment.requiresManualApproval,
    phoneChecksAvailable: input.phoneChecksAvailable,
  };
}

/** The renter's readiness for an order, read on the server. */
export async function rentalReadiness(
  admin: Admin,
  user: { id: string; email_confirmed_at?: string | null },
  lines: OrderLineForTrust[],
  delivery: boolean,
  phoneChecksAvailable: boolean,
  now: Date = new Date(),
): Promise<RentalReadiness> {
  const { facts, holdings, verificationStatus } = await loadRenterFacts(admin, user, now);
  return buildReadiness({ facts, verificationStatus, holdings, lines, delivery, now, phoneChecksAvailable });
}

/**
 * One listing as an order line for the trust check, valued on the server.
 * Null if it is not listed: deleted and unpublished (draft, in review,
 * archived) listings read the same, so nothing about them leaks.
 * is_published is kept equal to listing_status = 'published' (migration 072).
 */
export async function trustLineForRental(
  admin: Admin,
  rentalId: string,
  quantity: number,
  startDate?: string,
  endDate?: string,
): Promise<OrderLineForTrust | null> {
  const { data, error } = await admin
    .from('smart_rentals')
    .select('id, replacement_value, deposit_amount')
    .eq('id', rentalId)
    .eq('is_published', true)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error('could not load listing');
  if (!data) return null;
  return {
    unitReplacementValueCents: toCents(itemValue(data as { replacement_value?: number | null; deposit_amount?: number | null })),
    quantity: Math.max(1, Math.floor(quantity)),
    ...(startDate && endDate ? { startDate, endDate } : {}),
  };
}

/**
 * Cart lines as order lines, valued as the checkout values them (each line
 * keeps its own dates). A line without dates takes `fallback` when given,
 * as the checkout gives undated lines the dates it is sent.
 */
export function trustLinesFromCart(
  items: readonly {
    quantity: number;
    start_date: string | null;
    end_date: string | null;
    rental: { replacement_value?: number | null; deposit_amount?: number | null };
  }[],
  fallback?: { startDate: string; endDate: string },
): OrderLineForTrust[] {
  return items.map((item) => ({
    unitReplacementValueCents: toCents(itemValue(item.rental)),
    quantity: item.quantity,
    ...(item.start_date && item.end_date
      ? { startDate: item.start_date, endDate: item.end_date }
      : fallback
        ? { startDate: fallback.startDate, endDate: fallback.endDate }
        : {}),
  }));
}
