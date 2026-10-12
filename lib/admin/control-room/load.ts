import type { SupabaseClient } from '@supabase/supabase-js';
import { checkAiBudget } from '@/lib/ai/budget';
import { isMissingPipeline } from '@/lib/rental/repos';
import type {
  BugRow,
  ChatRow,
  DisputeRow,
  DraftRow,
  FindingRow,
  GearBookingRow,
  IdCheckRow,
  ListingRow,
  OwnerPayoutRow,
  RefundRow,
  RequestRow,
  ServiceBookingRow,
  SignupRow,
  TodayFacts,
} from './today';

/**
 * Reads everything the Today page needs, with the service role. The caller
 * must already have checked that the person is an admin.
 *
 * Every read stands alone: one that fails (a table not on this database yet,
 * a timeout) becomes `null` for that part and the rest of the page still
 * shows. Lists are capped, because this page answers "what now?", not "show
 * me everything".
 */

type Db = SupabaseClient;
type Res<T> = { data: T[] | null; error: { code?: string; message?: string } | null };

const CAP = 200;

async function rows<T>(label: string, q: PromiseLike<Res<T>>): Promise<T[] | null> {
  try {
    const { data, error } = await q;
    if (error) {
      if (!isMissingPipeline(error)) console.error(`[admin/today] ${label}:`, error.message);
      return null;
    }
    return data ?? [];
  } catch (err) {
    console.error(`[admin/today] ${label} threw:`, err);
    return null;
  }
}

interface ProfileName { id: string; display_name: string | null; first_name: string | null; last_name: string | null; verification_status?: string | null }

function nameOf(p: ProfileName | undefined, fallback: string): string {
  if (!p) return fallback;
  const full = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
  return p.display_name?.trim() || full || fallback;
}

/** Look up people's names once for every list on the page. */
async function namesFor(db: Db, ids: Iterable<string>): Promise<Map<string, ProfileName>> {
  const unique = [...new Set([...ids].filter(Boolean))];
  const out = new Map<string, ProfileName>();
  for (let i = 0; i < unique.length; i += 150) {
    const batch = unique.slice(i, i + 150);
    const { data } = await db.from('profiles').select('id, display_name, first_name, last_name, verification_status').in('id', batch);
    for (const p of (data ?? []) as ProfileName[]) out.set(p.id, p);
  }
  return out;
}

function paymentsMode(): TodayFacts['payments'] {
  const key = process.env.PAYSTACK_SECRET_KEY ?? '';
  if (!key) return 'off';
  return key.startsWith('sk_test_') ? 'test' : 'live';
}

export async function loadTodayFacts(db: Db, now: Date = new Date()): Promise<TodayFacts> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const fortnightBack = twoWeeksAgo.slice(0, 10);

  const [
    idChecks, disputes, requests, service, gear, welcomes, bugs, press, findings, lastRun,
    payouts, refunds, listings, chats, signups, ai, payoutTiming, cancelledGear,
  ] = await Promise.all([
    rows('id checks', db.from('profiles')
      .select('id, display_name, first_name, last_name, verification_submitted_at')
      .eq('verification_status', 'pending').order('verification_submitted_at').limit(CAP)),
    rows('disputes', db.from('disputes')
      .select('id, dispute_type, reason, filed_by, filed_at, status')
      .in('status', ['open', 'investigating', 'escalated']).order('filed_at').limit(CAP)),
    rows('requests', db.from('crew_requests')
      .select('id, client_name, project_type, description, created_at')
      .eq('status', 'pending').order('created_at').limit(CAP)),
    // Live service bookings, plus anything finished recently (for money and activity).
    rows('service bookings', db.from('bookings')
      .select('id, reference, client_id, client_email, creator_id, status, payout_status, cancellation_refund_status, cancellation_refund_amount, total, creator_amount, shoot_date, location, paid_at, created_at, updated_at')
      .or(`status.in.(pending,paid,accepted,delivered,completed,disputed,pending_reassignment),created_at.gte.${twoWeeksAgo},cancellation_refund_status.in.(pending,failed,manual_review)`)
      .order('created_at', { ascending: false }).limit(CAP)),
    rows('gear bookings', db.from('equipment_bookings')
      .select('id, user_id, rental_id, status, payment_method, fulfilment_method, start_date, end_date, total_price, amount_due, created_at, payfast_payment_id, cancellation_refund_status, cancellation_refund_amount')
      .or(`status.in.(pending,confirmed,active,return_pending,overdue,disputed),created_at.gte.${twoWeeksAgo},end_date.gte.${fortnightBack}`)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false }).limit(CAP)),
    rows('welcomes', db.from('welcome_messages').select('user_id').eq('status', 'draft').limit(CAP)),
    rows('bugs', db.from('bug_reports').select('id, title, severity, created_at').eq('status', 'open').order('created_at', { ascending: false }).limit(50)),
    rows('press drafts', db.from('press').select('id, title, updated_at').eq('is_published', false).is('deleted_at', null).order('updated_at', { ascending: false }).limit(20)),
    rows('findings', db.from('ops_findings').select('id, severity, title, last_seen_at').in('status', ['open', 'acknowledged']).order('last_seen_at', { ascending: false }).limit(50)),
    rows('check runs', db.from('ops_check_runs').select('finished_at').not('finished_at', 'is', null).order('finished_at', { ascending: false }).limit(1)),
    rows('owner payouts', db.from('owner_payouts')
      .select('id, owner_id, state, owner_amount_cents, hold_reasons, scheduled_at')
      .in('state', ['scheduled', 'held']).lte('scheduled_at', now.toISOString()).order('scheduled_at').limit(CAP)),
    rows('refunds', db.from('refund_obligations')
      .select('id, state, amount_cents, reason, created_at')
      .not('state', 'in', '(processed,cancelled)').order('created_at').limit(CAP)),
    rows('listings', db.from('smart_rentals')
      .select('id, title, owner_id, created_at')
      .eq('listing_status', 'pending_review').is('deleted_at', null).order('created_at').limit(CAP)),
    rows('chats', db.from('chat_conversations').select('agent_id, started_at').gte('started_at', monthStart).limit(5000)),
    rows('signups', db.from('profiles').select('id, display_name, first_name, last_name, created_at').order('created_at', { ascending: false }).limit(10)),
    checkAiBudget(db, 0, now).then((v) => ({ spent: v.spent, budget: v.budget })).catch(() => null),
    // Payout timing (migration 073); read on its own so the page works without it.
    rows('payout timing', db.from('bookings').select('id, payout_due_at, payout_last_error').in('status', ['completed', 'delivered']).limit(CAP)),
    // Cancelled gear bookings with a refund still to settle (paid back by hand for EFT and cash).
    rows('cancelled gear', db.from('equipment_bookings')
      .select('id, user_id, rental_id, status, payment_method, fulfilment_method, start_date, end_date, total_price, amount_due, created_at, payfast_payment_id, cancellation_refund_status, cancellation_refund_amount')
      .eq('status', 'cancelled').eq('cancellation_refund_status', 'pending').limit(CAP)),
  ]);

  type SvcRaw = { id: string; reference: string | null; client_id: string | null; client_email: string | null; creator_id: string | null; status: string; payout_status: string | null; cancellation_refund_status: string | null; cancellation_refund_amount: number | null; total: number | null; creator_amount: number | null; shoot_date: string | null; location: string | null; paid_at: string | null; created_at: string; updated_at: string | null };
  type GearRaw = {
    id: string; user_id: string | null; rental_id: string | null; status: string; payment_method: string | null; fulfilment_method: string | null;
    start_date: string; end_date: string; total_price: number | null; amount_due: number | null; created_at: string;
    payfast_payment_id: string | null; cancellation_refund_status: string | null; cancellation_refund_amount: number | null;
  };
  type PayoutRaw = { id: string; owner_id: string; owner_amount_cents: number; hold_reasons: string[] | null; scheduled_at: string };
  type ListingRaw = { id: string; title: string; owner_id: string | null; created_at: string };
  type DisputeRaw = { id: string; dispute_type: string; reason: string | null; filed_by: string | null; filed_at: string | null; status: string };

  const svc = service as SvcRaw[] | null;
  const gr = gear === null ? null : [...(gear as GearRaw[]), ...((cancelledGear as GearRaw[] | null) ?? [])];
  const timing = new Map(
    ((payoutTiming as { id: string; payout_due_at: string | null; payout_last_error: string | null }[] | null) ?? []).map((t) => [t.id, t]),
  );
  const po = payouts as PayoutRaw[] | null;
  const li = listings as ListingRaw[] | null;
  const di = disputes as DisputeRaw[] | null;

  const people = await namesFor(db, [
    ...(svc ?? []).flatMap((s) => [s.client_id ?? '', s.creator_id ?? '']),
    ...(gr ?? []).map((g) => g.user_id ?? ''),
    ...(po ?? []).map((p) => p.owner_id),
    ...(li ?? []).map((l) => l.owner_id ?? ''),
    ...(di ?? []).map((d) => d.filed_by ?? ''),
  ]);

  const gearIds = [...new Set((gr ?? []).map((g) => g.rental_id).filter((x): x is string => Boolean(x)))];
  const gearTitles = new Map<string, string>();
  if (gearIds.length) {
    const { data } = await db.from('smart_rentals').select('id, title').in('id', gearIds);
    for (const r of (data ?? []) as { id: string; title: string }[]) gearTitles.set(r.id, r.title);
  }

  const asName = (p: { id: string; display_name: string | null; first_name: string | null; last_name: string | null }): string =>
    nameOf(p, 'Someone');

  return {
    now,
    idChecks: (idChecks as (ProfileName & { verification_submitted_at: string | null })[] | null)?.map(
      (p): IdCheckRow => ({ id: p.id, name: asName(p), submittedAt: p.verification_submitted_at }),
    ) ?? null,
    disputes: di?.map((d): DisputeRow => ({
      id: d.id,
      kind: d.dispute_type,
      reason: (d.reason ?? '').replace(/_/g, ' '),
      filedBy: nameOf(people.get(d.filed_by ?? ''), 'Someone'),
      filedAt: d.filed_at,
      status: d.status,
    })) ?? null,
    requests: (requests as { id: string; client_name: string | null; project_type: string | null; description: string | null; created_at: string }[] | null)?.map(
      (r): RequestRow => ({
        id: r.id,
        client: r.client_name?.trim() || 'Someone',
        what: [r.project_type, r.description].filter(Boolean).join(': ').slice(0, 140) || 'No details given.',
        createdAt: r.created_at,
      }),
    ) ?? null,
    serviceBookings: svc?.map((s): ServiceBookingRow => ({
      id: s.id,
      reference: s.reference,
      status: s.status,
      payoutStatus: s.payout_status,
      refundStatus: s.cancellation_refund_status,
      client: nameOf(people.get(s.client_id ?? ''), s.client_email ?? 'A client'),
      creator: nameOf(people.get(s.creator_id ?? ''), 'the creator'),
      total: Number(s.total) || 0,
      creatorAmount: Number(s.creator_amount) || 0,
      refundAmount: s.cancellation_refund_amount == null ? null : Number(s.cancellation_refund_amount),
      shootDate: s.shoot_date,
      location: s.location,
      paidAt: s.paid_at,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      payoutDueAt: timing.get(s.id)?.payout_due_at ?? null,
      payoutError: timing.get(s.id)?.payout_last_error ?? null,
    })) ?? null,
    gearBookings: gr?.map((g): GearBookingRow => ({
      id: g.id,
      status: g.status,
      paymentMethod: g.payment_method,
      fulfilment: g.fulfilment_method,
      start: g.start_date,
      end: g.end_date,
      gear: gearTitles.get(g.rental_id ?? '') ?? 'Gear',
      renter: nameOf(people.get(g.user_id ?? ''), 'A customer'),
      total: Number(g.total_price) || 0,
      amountDue: g.amount_due == null ? null : Number(g.amount_due),
      createdAt: g.created_at,
      renterVerified: people.get(g.user_id ?? '')?.verification_status === 'verified',
      refundStatus: g.cancellation_refund_status,
      refundAmount: g.cancellation_refund_amount == null ? null : Number(g.cancellation_refund_amount),
      handPaid: Boolean(g.payfast_payment_id?.startsWith('manual:')),
    })) ?? null,
    welcomeDrafts: welcomes ? welcomes.length : null,
    bugs: (bugs as { id: string; title: string; severity: string | null; created_at: string }[] | null)?.map(
      (b): BugRow => ({ id: b.id, title: b.title, severity: b.severity, createdAt: b.created_at }),
    ) ?? null,
    pressDrafts: (press as { id: string; title: string; updated_at: string | null }[] | null)?.map(
      (p): DraftRow => ({ id: p.id, title: p.title, updatedAt: p.updated_at }),
    ) ?? null,
    findings: (findings as { id: string; severity: string; title: string; last_seen_at: string }[] | null)?.map(
      (x): FindingRow => ({ id: x.id, severity: x.severity, title: x.title, lastSeen: x.last_seen_at }),
    ) ?? null,
    lastCheckRun: (lastRun as { finished_at: string }[] | null)?.[0]?.finished_at ?? null,
    ownerPayouts: po?.map((p): OwnerPayoutRow => ({
      id: p.id,
      owner: nameOf(people.get(p.owner_id), 'An owner'),
      amountCents: p.owner_amount_cents,
      holdReasons: p.hold_reasons ?? [],
      scheduledAt: p.scheduled_at,
    })) ?? null,
    refunds: (refunds as { id: string; state: string; amount_cents: number; reason: string | null; created_at: string }[] | null)?.map(
      (r): RefundRow => ({ id: r.id, state: r.state, amountCents: r.amount_cents, reason: r.reason ?? '', createdAt: r.created_at }),
    ) ?? null,
    listings: li?.map((l): ListingRow => ({
      id: l.id,
      title: l.title,
      owner: nameOf(people.get(l.owner_id ?? ''), 'An owner'),
      createdAt: l.created_at,
    })) ?? null,
    ai,
    chats: (chats as { agent_id: string | null; started_at: string }[] | null)?.map(
      (c): ChatRow => ({ agentId: c.agent_id, startedAt: c.started_at }),
    ) ?? null,
    signups: (signups as (ProfileName & { created_at: string })[] | null)?.map(
      (p): SignupRow => ({ id: p.id, name: asName(p), createdAt: p.created_at }),
    ) ?? null,
    payments: paymentsMode(),
  };
}
