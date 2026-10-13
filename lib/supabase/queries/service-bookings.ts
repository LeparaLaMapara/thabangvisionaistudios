import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import type { Booking } from '@/types/booking-system';
import type { ServiceActor } from '@/lib/core/services/fulfilment';
import { CLIENT_SERVICE_BOOKING_COLUMNS } from '@/lib/supabase/queries/columns';

const CREATOR_JOIN = 'creator:profiles!creator_id(id, display_name, avatar_url, crew_slug)';

export async function getClientBookings(clientId: string): Promise<(Booking & { creator: { id: string; display_name: string; avatar_url: string | null; crew_slug: string | null } | null })[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bookings')
    .select(`${CLIENT_SERVICE_BOOKING_COLUMNS}, ${CREATOR_JOIN}`)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[service-bookings] getClientBookings error:', error.message);
    return [];
  }
  return (data ?? []) as unknown as (Booking & { creator: { id: string; display_name: string; avatar_url: string | null; crew_slug: string | null } | null })[];
}

export async function getCreatorBookings(creatorId: string) {
  const supabase = await createClient();
  // Creator does NOT see client email/phone for privacy
  const base = 'id, reference, booking_type, project_category, project_description, deliverables, duration_hours, location, preferred_dates, creator_amount, payment_status, payout_status, status, client_rating, client_review, created_at, updated_at, paid_at, accepted_at, arrived_at, delivered_at, completed_at, shoot_date, cancellation_reason';
  const read = (columns: string) => supabase
    .from('bookings')
    .select(columns)
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false });

  let { data, error } = await read(`${base}, ${CREATOR_FULFILMENT_COLUMNS}`);
  // Before migration 073 the fulfilment columns do not exist yet.
  if (error && mentionsFulfilmentSchema(error.message)) ({ data, error } = await read(base));

  if (error) {
    console.error('[service-bookings] getCreatorBookings error:', error.message);
    return [];
  }
  const rows = (data ?? []) as unknown as CreatorBookingRow[];

  // A job an admin gave this creator is answered from that moment, not from
  // payment: the card shows the same deadline the daily job uses.
  const waiting = rows.filter((r) => r.status === 'paid' && !r.accepted_at).map((r) => r.id);
  if (waiting.length > 0) {
    const { times, error: assignError } = await getAssignTimes(supabase, waiting);
    if (assignError) console.error('[service-bookings] assignment times read failed:', assignError);
    for (const r of rows) {
      const at = times.get(r.id);
      if (at) r.assigned_at = at;
    }
  }
  return rows;
}

export async function getBookingByReference(reference: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bookings')
    .select(`*, ${CREATOR_JOIN}`)
    .eq('reference', reference)
    .single();

  if (error) return null;
  return data;
}

export async function getBookingById(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bookings')
    .select(`*, ${CREATOR_JOIN}`)
    .eq('id', id)
    .single();

  if (error) return null;
  return data;
}

export async function getAllBookings() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bookings')
    .select(`*, ${CREATOR_JOIN}`)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[service-bookings] getAllBookings error:', error.message);
    return [];
  }
  return data ?? [];
}

/** Get hourly rate based on project category (pure; lives in lib/bookings/rates.ts so the booking form quotes the same price). */
export { getHourlyRate } from '@/lib/bookings/rates';

// ─── Fulfilment (migration 073) ──────────────────────────────────────────────
// Server-side helpers for the service-booking state machine
// (lib/core/services/fulfilment.ts). They take the service-role client the
// route already holds: user sessions may only read bookings (migration 059).

/** Columns added by migration 073. Code deployed before it is applied falls back without them. */
export const FULFILMENT_COLUMNS = [
  'declined_at',
  'decline_reason',
  'revisions_included',
  'revisions_used',
  'revision_policy',
  'cancellation_policy',
  'accepted_by_client_at',
  'payout_due_at',
  'dispute_window_ends_at',
  'payout_claimed_at',
  'payout_last_error',
] as const;

/** What a creator sees of the fulfilment columns. */
export const CREATOR_FULFILMENT_COLUMNS = 'declined_at, decline_reason, revisions_included, revisions_used, revision_policy, accepted_by_client_at, payout_due_at, dispute_window_ends_at';

export interface CreatorBookingRow {
  id: string;
  reference: string;
  booking_type: string;
  project_category: string;
  project_description: string;
  deliverables: string;
  duration_hours: number;
  location: string | null;
  preferred_dates: string | null;
  creator_amount: number;
  payment_status: string;
  payout_status: string;
  status: string;
  client_rating: number | null;
  client_review: string | null;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  accepted_at: string | null;
  arrived_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  shoot_date: string | null;
  cancellation_reason?: string | null;
  declined_at?: string | null;
  decline_reason?: string | null;
  revisions_included?: number | null;
  revisions_used?: number | null;
  revision_policy?: string | null;
  accepted_by_client_at?: string | null;
  payout_due_at?: string | null;
  dispute_window_ends_at?: string | null;
  /** When an admin last gave this job to this creator (from service_booking_events), if ever. */
  assigned_at?: string | null;
}

/** True when a database error is about migration 073 not being applied yet. */
export function mentionsFulfilmentSchema(message: string | null | undefined): boolean {
  if (!message) return false;
  return FULFILMENT_COLUMNS.some((c) => message.includes(c)) || message.includes('service_booking_events');
}

/** The same patch without the 073 columns, for a database that does not have them yet. */
export function withoutFulfilmentColumns<T extends Record<string, unknown>>(patch: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!(FULFILMENT_COLUMNS as readonly string[]).includes(k)) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * Read one booking with the 073 columns, or without them before the migration.
 * `base` and `extra` are comma-separated column lists.
 */
export async function readServiceBooking<T>(
  db: SupabaseClient,
  id: string,
  base: string,
  extra: string,
): Promise<{ data: T | null; error: string | null; degraded: boolean }> {
  const read = (columns: string) => db.from('bookings').select(columns).eq('id', id).maybeSingle();
  const first = await read(extra ? `${base}, ${extra}` : base);
  if (!first.error) return { data: (first.data as T | null) ?? null, error: null, degraded: false };
  if (!extra || !mentionsFulfilmentSchema(first.error.message)) return { data: null, error: first.error.message, degraded: false };
  const second = await read(base);
  if (second.error) return { data: null, error: second.error.message, degraded: true };
  return { data: (second.data as T | null) ?? null, error: null, degraded: true };
}

export type ServiceUpdateResult =
  | { ok: true; updated: boolean; degraded: boolean }
  | { ok: false; error: string; code: string | null };

/**
 * Compare-and-set: update the booking only while it is still in `fromStatus`
 * (null skips the status check). `updated` is false when someone else moved
 * it first. Retries without the 073 columns on a database that lacks them.
 */
export async function updateServiceBooking(
  db: SupabaseClient,
  id: string,
  fromStatus: string | null,
  patch: Record<string, unknown>,
  /** Further columns that must still hold the value read (null compares with IS NULL). */
  expect: Record<string, string | null> = {},
): Promise<ServiceUpdateResult> {
  const run = async (values: Record<string, unknown>) => {
    let q = db.from('bookings').update(values).eq('id', id);
    if (fromStatus) q = q.eq('status', fromStatus);
    for (const [column, value] of Object.entries(expect)) q = value === null ? q.is(column, null) : q.eq(column, value);
    return q.select('id');
  };
  let degraded = false;
  let { data, error } = await run(patch);
  if (error && mentionsFulfilmentSchema(error.message)) {
    degraded = true;
    const reduced = withoutFulfilmentColumns(patch);
    // Nothing left to write on this database (e.g. only bookkeeping columns).
    if (Object.keys(reduced).length === 0) return { ok: true, updated: false, degraded };
    ({ data, error } = await run(reduced));
  }
  if (error) return { ok: false, error: error.message, code: (error as { code?: string }).code ?? null };
  return { ok: true, updated: Array.isArray(data) && data.length > 0, degraded };
}

/**
 * Append one line of history. Best effort: history never blocks the change it
 * records. Returns false when the row could not be written (true when the
 * table does not exist yet, before migration 073: there is nothing to write to).
 */
export async function recordServiceBookingEvent(
  db: SupabaseClient,
  ev: {
    bookingId: string;
    event: string;
    from: string | null;
    to: string | null;
    actor: ServiceActor;
    actorId: string | null;
    reason?: string | null;
  },
): Promise<boolean> {
  try {
    const { error } = await db.from('service_booking_events').insert({
      booking_id: ev.bookingId,
      event: ev.event,
      from_status: ev.from,
      to_status: ev.to,
      actor: ev.actor,
      actor_id: ev.actorId,
      reason: ev.reason ?? null,
    });
    if (error && !mentionsFulfilmentSchema(error.message)) {
      console.error('[service-bookings] history insert failed:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[service-bookings] history insert failed:', err);
    return false;
  }
}

/** The history event written when an admin gives a booking to a creator. */
export const ADMIN_ASSIGN_EVENT = 'admin_assign';

/**
 * When each booking was last given to a creator by an admin: the newest
 * 'admin_assign' row in service_booking_events, by booking id. A booking with
 * no such row is missing from the map (its answer clock starts at payment).
 * Before migration 073 the table does not exist, so no booking was ever
 * recorded as assigned: an empty map, not an error. Any other read failure is
 * returned as an error, so a caller can hold back rather than use the wrong
 * clock (lib/bookings/answer-by.ts).
 */
export async function getAssignTimes(
  db: SupabaseClient,
  bookingIds: string[],
): Promise<{ times: Map<string, string>; error: string | null }> {
  const times = new Map<string, string>();
  if (bookingIds.length === 0) return { times, error: null };
  const { data, error } = await db
    .from('service_booking_events')
    .select('booking_id, created_at')
    .eq('event', ADMIN_ASSIGN_EVENT)
    .in('booking_id', bookingIds);
  if (error) {
    if (mentionsFulfilmentSchema(error.message)) return { times, error: null };
    return { times, error: error.message };
  }
  for (const row of (data ?? []) as { booking_id: string; created_at: string }[]) {
    const seen = times.get(row.booking_id);
    if (!seen || Date.parse(row.created_at) > Date.parse(seen)) times.set(row.booking_id, row.created_at);
  }
  return { times, error: null };
}

/** Dispute statuses that hold a creator payout. */
export const PAYOUT_BLOCKING_DISPUTE_STATUSES = ['open', 'investigating', 'escalated'] as const;

/**
 * Open disputes on a service booking. null when the lookup failed: the caller
 * must treat that as "may be disputed" and hold the payout.
 */
export async function countOpenServiceDisputes(db: SupabaseClient, bookingId: string): Promise<number | null> {
  try {
    const { count, error } = await db
      .from('disputes')
      .select('id', { count: 'exact', head: true })
      .eq('booking_id', bookingId)
      .in('status', [...PAYOUT_BLOCKING_DISPUTE_STATUSES]);
    if (error || count === null || count === undefined) return null;
    return count;
  } catch {
    return null;
  }
}

// ─── Disputes on service bookings (085) ─────────────────────────────────────

/** Statuses a dispute moves to 'disputed' (and back from, once it is closed). */
export const DISPUTE_HOLDABLE_SERVICE_STATUSES = ['paid', 'accepted', 'delivered', 'completed'] as const;

/** Dispute statuses that are finished; anything else is live. */
export const CLOSED_DISPUTE_STATUSES = ['resolved', 'dismissed'] as const;

export type DisputeHoldResult =
  | { ok: true; moved: boolean }
  | { ok: false; error: string; changed?: boolean };

/**
 * Moves a service booking to 'disputed', remembering the status it had so
 * staff can put it back when the dispute is closed. Compare-and-set on the
 * status read by the caller. A booking in any other status (unpaid, paid
 * out, declined) keeps its status: the open dispute row still holds the
 * payout (countOpenServiceDisputes), and a person handles it.
 */
export async function holdServiceBookingForDispute(
  db: SupabaseClient,
  booking: { id: string; status: string },
  now: Date,
): Promise<DisputeHoldResult> {
  if (!(DISPUTE_HOLDABLE_SERVICE_STATUSES as readonly string[]).includes(booking.status)) {
    return { ok: true, moved: false };
  }
  const r = await updateServiceBooking(db, booking.id, booking.status, {
    status: 'disputed',
    status_before_dispute: booking.status,
    disputed_at: now.toISOString(),
    updated_at: now.toISOString(),
  });
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.updated) return { ok: false, error: 'The booking changed while the dispute was being filed.', changed: true };
  return { ok: true, moved: true };
}

export type DisputeReleaseResult =
  | { ok: true; restoredTo: string | null }
  | { ok: false; error: string };

/**
 * After staff close a dispute: a 'disputed' service booking with no other
 * live dispute goes back to the status it had before. Nothing happens when
 * it is not 'disputed', another dispute is still live, or the earlier status
 * is unknown (a person moves it then). Money rules are unchanged: a refund
 * recorded on the booking still holds the payout.
 */
export async function releaseServiceBookingFromDispute(
  db: SupabaseClient,
  bookingId: string,
  now: Date,
): Promise<DisputeReleaseResult> {
  const { data, error } = await db
    .from('bookings')
    .select('id, status, status_before_dispute')
    .eq('id', bookingId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const row = data as { status: string; status_before_dispute: string | null } | null;
  if (!row || row.status !== 'disputed' || !row.status_before_dispute) return { ok: true, restoredTo: null };

  const live = await countOpenServiceDisputes(db, bookingId);
  if (live === null) return { ok: false, error: 'Could not check for other open disputes.' };
  if (live > 0) return { ok: true, restoredTo: null };

  const r = await updateServiceBooking(db, bookingId, 'disputed', {
    status: row.status_before_dispute,
    status_before_dispute: null,
    updated_at: now.toISOString(),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, restoredTo: r.updated ? row.status_before_dispute : null };
}
