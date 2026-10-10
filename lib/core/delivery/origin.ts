/**
 * Where the gear on a delivery leg lives (Phase 8: collection from the
 * owner's address). Pure.
 *
 * Before Phase 8 every leg ran between OUR SITE and the renter: community
 * owners brought their gear to the studio. Now a community listing whose
 * owner opted in can be collected from (and returned to) the owner's own
 * verified pickup address. The gear's "origin" is therefore one of:
 *
 *   - our site (`originOwnerId = null`): studio gear, and community gear the
 *     owner brings to the studio (no opt-in, no verified pickup address, or
 *     the owner is not verified/active);
 *   - an owner (`originOwnerId = <owner's user id>`): the owner's pickup
 *     address. The outbound leg starts there and the return leg ends there.
 *
 * An order with gear from several origins has one outbound leg per origin
 * and one return leg back to each origin. Every per-leg key (merchant
 * reference, dispatch idempotency key, ledger earn key) carries an origin
 * discriminator that is EMPTY for our site, so every key made before Phase 8
 * (studio-only orders) is unchanged (D-84, D-85).
 */

import { DELIVERY_POLICY, STUDIO } from '@/lib/constants';
import { inServiceArea } from './policy';

/** null = our site. */
export type OriginOwnerId = string | null;

export function sameOrigin(a: OriginOwnerId | undefined, b: OriginOwnerId | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

/**
 * The origin part of a per-leg key: '' for our site (keys made before Phase 8
 * stay exactly as they were), '@{ownerId}' for an owner's address.
 */
export function originDiscriminator(originOwnerId: OriginOwnerId | undefined): string {
  return originOwnerId ? `@${originOwnerId}` : '';
}

/** The origin part of a merchant reference: '' for our site, '_{owner id without dashes}' for an owner. */
export function originReferenceSuffix(originOwnerId: OriginOwnerId | undefined): string {
  return originOwnerId ? `_${originOwnerId.replace(/-/g, '')}` : '';
}

/** A stable sort key: our site first, then owners by id. */
export function originSortKey(originOwnerId: OriginOwnerId | undefined): string {
  return originOwnerId ? `1:${originOwnerId}` : '0:';
}

/** Facts the server reads to decide whether a community line is collected from its owner's address. */
export interface OwnerPickupFacts {
  /** smart_rentals.owner_type = 'community' with an owner id. */
  community: boolean;
  ownerId: string | null;
  /** The listing is live (published). */
  listingLive: boolean;
  /** listing_private.owner_pickup: the owner opted this listing in (default false, D-86). */
  listingOptIn: boolean;
  /** profiles.verification_status = 'verified'. */
  ownerVerified: boolean;
  /** profiles.is_suspended (and the suspension has not expired). */
  ownerSuspended: boolean;
  /** The owner's active pickup address (purpose owner_pickup, not retired, not redacted), if any. */
  address: { id: string; province: string | null } | null;
}

export type OwnerPickupBlock =
  | 'switched_off'
  | 'not_community'
  | 'listing_not_live'
  | 'listing_not_opted_in'
  | 'owner_not_verified'
  | 'owner_suspended'
  | 'no_pickup_address'
  | 'address_outside_area';

export type OwnerPickupDecision = { ok: true; ownerId: string; addressId: string } | { ok: false; reason: OwnerPickupBlock };

/**
 * Whether a line's gear is collected from its owner's address. Anything short
 * of every condition means our site: the owner brings the gear to the studio,
 * exactly as before Phase 8 (never a refusal of the order).
 */
export function ownerPickupDecision(
  f: OwnerPickupFacts,
  policy: { enabled: boolean; serviceProvince: string } = { enabled: DELIVERY_POLICY.ownerPickup.enabled, serviceProvince: STUDIO.serviceArea.province },
): OwnerPickupDecision {
  if (!policy.enabled) return { ok: false, reason: 'switched_off' };
  if (!f.community || !f.ownerId) return { ok: false, reason: 'not_community' };
  if (!f.listingLive) return { ok: false, reason: 'listing_not_live' };
  if (!f.listingOptIn) return { ok: false, reason: 'listing_not_opted_in' };
  if (f.ownerSuspended) return { ok: false, reason: 'owner_suspended' };
  if (!f.ownerVerified) return { ok: false, reason: 'owner_not_verified' };
  if (!f.address) return { ok: false, reason: 'no_pickup_address' };
  if (!inServiceArea({ province: f.address.province }, { serviceProvince: policy.serviceProvince })) return { ok: false, reason: 'address_outside_area' };
  return { ok: true, ownerId: f.ownerId, addressId: f.address.id };
}

/** The origin of one line, as the server decided it. */
export interface LineOrigin {
  originOwnerId: OriginOwnerId;
  /** delivery_addresses id of the gear's end of the leg: our site, or the owner's pickup address. */
  addressId: string;
}

/**
 * Group lines by origin, our site first, then owners by id (deterministic, so
 * the same cart always produces the same legs). Lines with no decided origin
 * go to our site.
 */
export function groupLinesByOrigin<L extends { rentalId: string }>(
  lines: readonly L[],
  originOf: ReadonlyMap<string, LineOrigin>,
  siteAddressId: string,
): { originOwnerId: OriginOwnerId; addressId: string; lines: L[] }[] {
  const groups = new Map<string, { originOwnerId: OriginOwnerId; addressId: string; lines: L[] }>();
  for (const l of lines) {
    const o = originOf.get(l.rentalId);
    const origin: LineOrigin = o && o.originOwnerId ? o : { originOwnerId: null, addressId: siteAddressId };
    const k = originSortKey(origin.originOwnerId);
    const g = groups.get(k) ?? { originOwnerId: origin.originOwnerId, addressId: origin.addressId, lines: [] };
    g.lines.push(l);
    groups.set(k, g);
  }
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, g]) => g);
}

/** What a renter may know about where gear comes from: our site, or the owner's suburb at most. Never the street. */
export function publicOriginArea(p: { suburb?: string | null; city?: string | null } | null): string | null {
  if (!p) return null;
  const s = (p.suburb ?? '').trim() || (p.city ?? '').trim();
  return s ? s.slice(0, 80) : null;
}
