import { createAdminClient } from '@/lib/supabase/server';
import type { ListingForReview, ListingOwnerFacts } from '@/lib/core/listings/review';

/**
 * Server-side helpers for community listings. Not a route (the `_lib`
 * folder is private to the app router).
 *
 * Owner reads and writes go through the service-role client with an
 * explicit owner_id filter. The repo's RLS on smart_rentals has a public
 * SELECT for published rows and an admin-only write policy; there is no
 * owner policy, so a user-session client could neither see an owner's own
 * drafts nor save them. Ownership is checked here instead, on every call.
 */

export type Admin = ReturnType<typeof createAdminClient>;

export function adminClient(): Admin {
  return createAdminClient();
}

/** Columns the owner's dashboard needs. The owner may see their own serial number. */
export const OWNER_LISTING_COLUMNS = [
  'id', 'slug', 'title', 'description', 'category', 'sub_category', 'brand', 'model',
  'price_per_day', 'price_per_week', 'deposit_amount', 'replacement_value', 'serial_number',
  'replacement_value_evidence', 'rental_includes', 'thumbnail_url', 'cover_public_id', 'gallery', 'metadata',
  'owner_type', 'owner_id', 'is_published', 'is_ai_generated', 'listing_status', 'review_notes',
  'reviewed_at', 'submitted_at', 'ai_fields', 'owner_attestations', 'created_at', 'updated_at', 'deleted_at',
].join(', ');

export interface OwnerListingRow {
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
  replacement_value_evidence: string | null;
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
  review_notes: string | null;
  reviewed_at: string | null;
  submitted_at: string | null;
  ai_fields: unknown;
  owner_attestations: unknown;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
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
    replacement_value: row.replacement_value === null ? null : Number(row.replacement_value),
    location: locationOf(row),
    ai_fields: row.ai_fields,
    owner_attestations: row.owner_attestations,
  };
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
  return (data as unknown as OwnerListingRow | null) ?? null;
}

const OPEN_BOOKING_DISPUTE = 'disputed';

/**
 * Everything the review rules need to know about an owner. Throws when any
 * read fails: the caller answers 503 rather than deciding on partial facts.
 * Only counts leave this function.
 */
export async function loadOwnerFacts(admin: Admin, ownerId: string, excludeListingId?: string): Promise<ListingOwnerFacts> {
  let listingsQuery = admin
    .from('smart_rentals')
    .select('id, listing_status')
    .eq('owner_id', ownerId)
    .is('deleted_at', null);
  if (excludeListingId) listingsQuery = listingsQuery.neq('id', excludeListingId);

  const [profileRes, bankRes, listingsRes, completedRes, disputedRes] = await Promise.all([
    admin.from('profiles').select('verification_status, is_suspended').eq('id', ownerId).maybeSingle(),
    admin.from('banking_details').select('is_verified').eq('user_id', ownerId).maybeSingle(),
    listingsQuery,
    admin
      .from('equipment_bookings')
      .select('id, smart_rentals!inner(owner_id)', { count: 'exact', head: true })
      .eq('status', 'completed')
      .eq('smart_rentals.owner_id', ownerId),
    admin
      .from('equipment_bookings')
      .select('id, smart_rentals!inner(owner_id)', { count: 'exact', head: true })
      .eq('status', OPEN_BOOKING_DISPUTE)
      .eq('smart_rentals.owner_id', ownerId),
  ]);

  for (const [label, res] of [
    ['profile', profileRes],
    ['banking', bankRes],
    ['listings', listingsRes],
    ['completed', completedRes],
    ['disputed', disputedRes],
  ] as const) {
    if (res.error) throw new Error(`loadOwnerFacts(${label}): ${res.error.message}`);
  }

  const profile = profileRes.data as { verification_status: string | null; is_suspended: boolean | null } | null;
  const bank = bankRes.data as { is_verified: boolean | null } | null;
  const listings = (listingsRes.data ?? []) as { id: string; listing_status: string }[];
  const count = (status: string): number => listings.filter((l) => l.listing_status === status).length;

  return {
    verificationStatus: profile?.verification_status ?? null,
    payoutAccountVerified: bank?.is_verified === true,
    isSuspended: profile?.is_suspended === true,
    openDisputes: disputedRes.count ?? 0,
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
