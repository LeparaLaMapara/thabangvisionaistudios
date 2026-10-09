import { createAdminClient } from '@/lib/supabase/server';
import {
  countOpenDisputes,
  OPEN_DISPUTE_STATUSES,
  type ListingForReview,
  type ListingOwnerFacts,
} from '@/lib/core/listings/review';

/**
 * Server-side helpers for community listings. Not a route (the `_lib`
 * folder is private to the app router).
 *
 * Owner reads and writes go through the service-role client with an
 * explicit owner_id filter. The repo's RLS on smart_rentals has a public
 * SELECT for published rows and an admin-only write policy; there is no
 * owner policy, so a user-session client could neither see an owner's own
 * drafts nor save them. Ownership is checked here instead, on every call.
 *
 * Review notes, AI flags and owner declarations live in listing_private
 * (migration 072), not on smart_rentals, because the public SELECT policy
 * returns every column of a published smart_rentals row.
 */

export type Admin = ReturnType<typeof createAdminClient>;

export function adminClient(): Admin {
  return createAdminClient();
}

const PUBLIC_TABLE_COLUMNS = [
  'id', 'slug', 'title', 'description', 'category', 'sub_category', 'brand', 'model',
  'price_per_day', 'price_per_week', 'deposit_amount', 'replacement_value', 'serial_number',
  'rental_includes', 'thumbnail_url', 'cover_public_id', 'gallery', 'metadata',
  'owner_type', 'owner_id', 'is_published', 'is_ai_generated', 'listing_status',
  'created_at', 'updated_at', 'deleted_at',
];
const PRIVATE_COLUMNS = [
  'review_notes', 'reviewed_by', 'reviewed_at', 'submitted_at', 'ai_fields', 'owner_attestations',
  'replacement_value_evidence',
];

/**
 * The listing plus its embedded private row. The owner may see their own
 * serial number. Flatten results with flattenListing(). The private row's
 * updated_at comes back as private_updated_at (its version, see
 * savePrivateIfUnchanged); it must not overwrite the listing's updated_at.
 */
export const OWNER_LISTING_COLUMNS = `${PUBLIC_TABLE_COLUMNS.join(', ')}, listing_private(${PRIVATE_COLUMNS.join(', ')}, private_updated_at:updated_at)`;

export interface ListingPrivateFields {
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  submitted_at: string | null;
  ai_fields: unknown;
  owner_attestations: unknown;
  replacement_value_evidence: string | null;
}

export interface OwnerListingRow extends ListingPrivateFields {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string | null;
  sub_category: string | null;
  brand: string | null;
  model: string | null;
  price_per_day: number | null;
  price_per_week: number | null;
  deposit_amount: number | null;
  replacement_value: number | null;
  serial_number: string | null;
  rental_includes: string[] | null;
  thumbnail_url: string | null;
  cover_public_id: string | null;
  gallery: { url: string; public_id: string }[] | null;
  metadata: Record<string, unknown> | null;
  owner_type: string | null;
  owner_id: string | null;
  is_published: boolean;
  is_ai_generated: boolean | null;
  listing_status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** listing_private.updated_at, or null when the listing has no private row yet. */
  private_updated_at: string | null;
}

const EMPTY_PRIVATE: ListingPrivateFields & { private_updated_at: null } = {
  private_updated_at: null,
  review_notes: null,
  reviewed_by: null,
  reviewed_at: null,
  submitted_at: null,
  ai_fields: null,
  owner_attestations: null,
  replacement_value_evidence: null,
};

/** Merges the embedded listing_private row (object, one-element array or null) into the listing. */
export function flattenListing(raw: unknown): OwnerListingRow {
  const r = { ...(raw as Record<string, unknown>) };
  const embedded = r.listing_private;
  delete r.listing_private;
  const priv = (Array.isArray(embedded) ? embedded[0] : embedded) as Partial<ListingPrivateFields> | null | undefined;
  return { ...(r as unknown as OwnerListingRow), ...EMPTY_PRIVATE, ...(priv ?? {}) };
}

/** What the owner's own dashboard receives: everything except the reviewer's id. */
export function forOwner(row: OwnerListingRow): Omit<OwnerListingRow, 'reviewed_by'> {
  const { reviewed_by: _reviewer, ...rest } = row;
  void _reviewer;
  return rest;
}

/**
 * A listing_private.updated_at value for a write: now, with random
 * microseconds (timestamptz keeps them), so two writes in the same
 * millisecond still leave different versions behind.
 */
export function privateVersionStamp(now: Date = new Date()): string {
  const micros = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return now.toISOString().replace('Z', `${micros}Z`);
}

/**
 * Writes the listing's private row (service role only; clients have no write
 * grant on listing_private), creating it if needed. Unconditional: for stamps
 * (submission, review) that must land whatever else was written. Returns the
 * version written. Throws on failure.
 */
export async function savePrivate(admin: Admin, rentalId: string, fields: Partial<ListingPrivateFields>): Promise<string> {
  const version = privateVersionStamp();
  const { error } = await admin
    .from('listing_private')
    .upsert({ rental_id: rentalId, ...fields, updated_at: version }, { onConflict: 'rental_id' });
  if (error) throw new Error(`savePrivate: ${error.message}`);
  return version;
}

const UNIQUE_VIOLATION = '23505';

/**
 * Writes the listing's private row only if it is still the version this
 * request read (`expected`: its private_updated_at, null = no row yet).
 * Returns the new version, or null when someone else wrote it meanwhile
 * (the caller answers 409; nothing was written). Throws on other failures.
 */
export async function savePrivateIfUnchanged(
  admin: Admin,
  rentalId: string,
  fields: Partial<ListingPrivateFields>,
  expected: string | null,
): Promise<string | null> {
  const version = privateVersionStamp();
  if (expected === null) {
    const { error } = await admin.from('listing_private').insert({ rental_id: rentalId, ...fields, updated_at: version });
    if (!error) return version;
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return null;
    throw new Error(`savePrivateIfUnchanged: ${error.message}`);
  }
  const { data, error } = await admin
    .from('listing_private')
    .update({ ...fields, updated_at: version })
    .eq('rental_id', rentalId)
    .eq('updated_at', expected)
    .select('rental_id')
    .maybeSingle();
  if (error) throw new Error(`savePrivateIfUnchanged: ${error.message}`);
  return data ? version : null;
}

/**
 * Whether the owner is suspended now, read with the service role. Unlike
 * checkNotSuspended (lib/auth), a failed read throws instead of answering
 * "not suspended", so callers fail closed. A suspension whose expiry has
 * passed does not count (checkNotSuspended clears those).
 */
export async function isOwnerSuspended(admin: Admin, userId: string, now: Date = new Date()): Promise<boolean> {
  const { data, error } = await admin
    .from('profiles')
    .select('is_suspended, suspension_expires_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`isOwnerSuspended: ${error.message}`);
  const p = data as { is_suspended: boolean | null; suspension_expires_at: string | null } | null;
  if (p?.is_suspended !== true) return false;
  if (p.suspension_expires_at && new Date(p.suspension_expires_at) < now) return false;
  return true;
}

export function locationOf(row: { metadata: unknown }): string | null {
  const m = row.metadata;
  if (!m || typeof m !== 'object') return null;
  const loc = (m as Record<string, unknown>).location;
  return typeof loc === 'string' && loc.trim() ? loc.trim() : null;
}

export function toReviewInput(row: OwnerListingRow): ListingForReview {
  return {
    listing_status: row.listing_status,
    owner_type: row.owner_type,
    title: row.title,
    category: row.category,
    price_per_day: row.price_per_day === null ? null : Number(row.price_per_day),
    price_per_week: row.price_per_week === null || row.price_per_week === undefined ? null : Number(row.price_per_week),
    replacement_value: row.replacement_value === null ? null : Number(row.replacement_value),
    location: locationOf(row),
    ai_fields: row.ai_fields,
    owner_attestations: row.owner_attestations,
  };
}

/** A not-deleted community listing by id (any owner), or null. For admin use. */
export async function loadCommunityListing(admin: Admin, id: string): Promise<OwnerListingRow | null> {
  const { data, error } = await admin
    .from('smart_rentals')
    .select(OWNER_LISTING_COLUMNS)
    .eq('id', id)
    .eq('owner_type', 'community')
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`loadCommunityListing: ${error.message}`);
  return data ? flattenListing(data) : null;
}

/** One of the caller's own, not-deleted community listings, or null. */
export async function loadOwnListing(admin: Admin, id: string, ownerId: string): Promise<OwnerListingRow | null> {
  const { data, error } = await admin
    .from('smart_rentals')
    .select(OWNER_LISTING_COLUMNS)
    .eq('id', id)
    .eq('owner_id', ownerId)
    .eq('owner_type', 'community')
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`loadOwnListing: ${error.message}`);
  return data ? flattenListing(data) : null;
}

const DISPUTED_BOOKING_STATUS = 'disputed';
const ID_CHUNK = 200;

interface ListResult<T> {
  data: T[] | null;
  error: { message: string } | null;
  count: number | null;
}

/** Fails closed: an error, or fewer rows returned than exist, throws. */
function completeRows<T>(label: string, res: ListResult<T>): T[] {
  if (res.error) throw new Error(`loadOwnerFacts(${label}): ${res.error.message}`);
  const rows = res.data ?? [];
  if (res.count !== null && res.count > rows.length) {
    throw new Error(`loadOwnerFacts(${label}): ${res.count} rows but only ${rows.length} returned`);
  }
  return rows;
}

/**
 * Booking ids, from `disputes` rows still open, that are hires of this
 * owner's gear. `disputes.equipment_booking_id` has no foreign key, so the
 * join is done in two steps.
 */
async function ownedOpenDisputeBookingIds(admin: Admin, ownerId: string): Promise<string[]> {
  const openRes = await admin
    .from('disputes')
    .select('equipment_booking_id', { count: 'exact' })
    .in('status', [...OPEN_DISPUTE_STATUSES])
    .not('equipment_booking_id', 'is', null);
  const open = completeRows('disputes', openRes as unknown as ListResult<{ equipment_booking_id: string | null }>);
  const bookingIds = Array.from(new Set(open.map((d) => d.equipment_booking_id).filter((v): v is string => !!v)));
  const owned: string[] = [];
  for (let i = 0; i < bookingIds.length; i += ID_CHUNK) {
    const res = await admin
      .from('equipment_bookings')
      .select('id, smart_rentals!inner(owner_id)', { count: 'exact' })
      .in('id', bookingIds.slice(i, i + ID_CHUNK))
      .eq('smart_rentals.owner_id', ownerId);
    owned.push(...completeRows('dispute bookings', res as unknown as ListResult<{ id: string }>).map((b) => b.id));
  }
  return owned;
}

/**
 * Everything the review rules need to know about an owner. Throws when any
 * read fails or comes back incomplete: the caller answers 503 rather than
 * deciding on partial facts. Only counts leave this function.
 */
export async function loadOwnerFacts(admin: Admin, ownerId: string, excludeListingId?: string): Promise<ListingOwnerFacts> {
  let listingsQuery = admin
    .from('smart_rentals')
    .select('id, listing_status', { count: 'exact' })
    .eq('owner_id', ownerId)
    .is('deleted_at', null);
  if (excludeListingId) listingsQuery = listingsQuery.neq('id', excludeListingId);

  const [profileRes, bankRes, listingsRes, completedRes, disputedRes, disputeRowBookingIds] = await Promise.all([
    admin.from('profiles').select('verification_status, is_suspended').eq('id', ownerId).maybeSingle(),
    admin.from('banking_details').select('is_verified').eq('user_id', ownerId).maybeSingle(),
    listingsQuery,
    // An owner hiring their own gear is not a track record: those hires
    // (renter = owner) are left out of the count.
    admin
      .from('equipment_bookings')
      .select('id, smart_rentals!inner(owner_id)', { count: 'exact', head: true })
      .eq('status', 'completed')
      .eq('smart_rentals.owner_id', ownerId)
      .neq('user_id', ownerId),
    admin
      .from('equipment_bookings')
      .select('id, smart_rentals!inner(owner_id)', { count: 'exact' })
      .eq('status', DISPUTED_BOOKING_STATUS)
      .eq('smart_rentals.owner_id', ownerId),
    ownedOpenDisputeBookingIds(admin, ownerId),
  ]);

  if (profileRes.error) throw new Error(`loadOwnerFacts(profile): ${profileRes.error.message}`);
  if (bankRes.error) throw new Error(`loadOwnerFacts(banking): ${bankRes.error.message}`);
  if (completedRes.error) throw new Error(`loadOwnerFacts(completed): ${completedRes.error.message}`);
  const listings = completeRows('listings', listingsRes as unknown as ListResult<{ id: string; listing_status: string }>);
  const disputedBookings = completeRows('disputed', disputedRes as unknown as ListResult<{ id: string }>);

  const profile = profileRes.data as { verification_status: string | null; is_suspended: boolean | null } | null;
  const bank = bankRes.data as { is_verified: boolean | null } | null;
  const count = (status: string): number => listings.filter((l) => l.listing_status === status).length;

  return {
    verificationStatus: profile?.verification_status ?? null,
    payoutAccountVerified: bank?.is_verified === true,
    isSuspended: profile?.is_suspended === true,
    openDisputes: countOpenDisputes(disputedBookings.map((b) => b.id), disputeRowBookingIds),
    publishedListings: count('published'),
    rejectedListings: count('rejected'),
    suspendedListings: count('suspended'),
    completedRentals: completedRes.count ?? 0,
  };
}

export type ListingNotificationType = 'listing_approved' | 'listing_rejected' | 'listing_suspended';

/**
 * Tells the owner what happened to their listing. Best effort: a failed
 * notification never undoes the review decision (it is logged).
 * The three types are added to notifications_type_check by migration 072.
 */
export async function notifyListingOwner(
  admin: Admin,
  ownerId: string,
  type: ListingNotificationType,
  title: string,
  body: string,
): Promise<void> {
  try {
    const { error } = await admin.from('notifications').insert({
      user_id: ownerId,
      type,
      title,
      body,
      link: '/dashboard/listings',
    });
    if (error) console.error('[listings] notification insert failed:', error.message);
  } catch (err) {
    console.error('[listings] notification insert failed:', err);
  }
}
