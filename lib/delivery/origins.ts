import { createAdminClient } from '@/lib/supabase/server';
import { ownerPickupDecision, type OwnerPickupDecision } from '@/lib/core/delivery/origin';
import type { DeliveryOriginPort } from '@/lib/core/delivery/repository';
import { FINAL_DELIVERY_STATES } from '@/lib/core/delivery/state';
import { isMissingPipeline } from '@/lib/rental/repos';
import type { VerifiedAddress } from './address';

/**
 * Collection from the owner's address (Phase 8, migration 080). Server only
 * (service role).
 *
 *  - The owner's pickup address is a `delivery_addresses` row with purpose
 *    `owner_pickup`, verified on the server by the AddressPort (never the
 *    browser's coordinates), with a driver contact and instructions. One
 *    active row per owner; a replaced one is retired (kept for the legs that
 *    used it, then purged by retention). RLS: only the owner reads it; staff
 *    see it only through the audited reveal (D21); renters never (D-88).
 *  - Per listing, the owner opts in (`listing_private.owner_pickup`, default
 *    false, D-86).
 *  - `SupabaseDeliveryOrigins` decides, per listing, whether its gear is
 *    collected from the owner's address (core `ownerPickupDecision`).
 */

type Admin = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** What an owner (and only they) sees of their own pickup address. */
export interface OwnerPickupAddressView {
  id: string;
  formattedAddress: string;
  suburb: string | null;
  city: string | null;
  postalCode: string | null;
  contactName: string;
  contactPhone: string;
  instructions: string | null;
  verifiedAt: string;
}

const PICKUP_COLS = 'id, formatted_address, suburb, city, province, postal_code, contact_name, contact_phone, instructions, verified_at';

function toView(r: Row): OwnerPickupAddressView {
  return {
    id: String(r.id),
    formattedAddress: String(r.formatted_address),
    suburb: str(r.suburb),
    city: str(r.city),
    postalCode: str(r.postal_code),
    contactName: String(r.contact_name),
    contactPhone: String(r.contact_phone),
    instructions: str(r.instructions),
    verifiedAt: String(r.verified_at),
  };
}

/** Delivery legs still using an address (not cancelled or failed, and not done). */
const LIVE_LEG = (status: string, acceptedAt: unknown): boolean => !FINAL_DELIVERY_STATES.includes(status as never) && !(status === 'delivered' && acceptedAt);

export class SupabaseOwnerPickup {
  constructor(private db: Admin = createAdminClient()) {}

  /** The owner's active pickup address, or null. */
  async current(ownerId: string): Promise<OwnerPickupAddressView | null> {
    const { data, error } = await this.db
      .from('delivery_addresses')
      .select(PICKUP_COLS)
      .eq('user_id', ownerId)
      .eq('purpose', 'owner_pickup')
      .is('retired_at', null)
      .is('redacted_at', null)
      .limit(1);
    if (error) {
      if (isMissingPipeline(error)) return null;
      throw new Error(`owner pickup address lookup failed: ${error.message}`);
    }
    const r = ((data ?? []) as Row[])[0];
    return r ? toView(r) : null;
  }

  /**
   * A live leg (outbound from, or return to) this owner's address: the
   * address cannot change under it. The database filters out finished legs
   * (cancelled, failed, delivered and accepted), so however long the owner's
   * history is, one live leg is always found (P3.4: an unfiltered read capped
   * at 200 rows could miss it).
   */
  async hasLiveLeg(ownerId: string): Promise<boolean> {
    const { data, error } = await this.db
      .from('delivery_shipments')
      .select('id, status, accepted_at')
      .eq('origin_owner_id', ownerId)
      .not('status', 'in', `(${FINAL_DELIVERY_STATES.join(',')})`)
      .or('status.neq.delivered,accepted_at.is.null')
      .limit(1);
    if (error) throw new Error(`owner pickup legs lookup failed: ${error.message}`);
    // Checked again here, so a filter the database did not apply can only make this stricter.
    return ((data ?? []) as Row[]).some((r) => LIVE_LEG(String(r.status), r.accepted_at));
  }

  /**
   * Save (or replace) the owner's pickup address. The previous active row is
   * retired and the new one stored in one database transaction
   * (delivery_save_owner_pickup, 080): one active row per owner (unique
   * index), and a failed insert leaves the old address active (P3.5).
   * Refused while a pickup or return from the current address is under way.
   */
  async save(p: { ownerId: string; address: VerifiedAddress; verifiedBy: string; contactName: string; contactPhone: string; instructions: string | null }): Promise<{ ok: true; address: OwnerPickupAddressView } | { ok: false; code: 'leg_in_progress' }> {
    if (await this.hasLiveLeg(p.ownerId)) return { ok: false, code: 'leg_in_progress' };
    const saved = await this.db.rpc('delivery_save_owner_pickup', {
      p_owner: p.ownerId,
      p_address: {
        formatted_address: p.address.formattedAddress,
        suburb: p.address.suburb,
        city: p.address.city,
        province: p.address.province ?? null,
        postal_code: p.address.postalCode,
        lat: p.address.lat,
        lng: p.address.lng,
        contact_name: p.contactName,
        contact_phone: p.contactPhone,
        instructions: p.instructions,
        verified_by: p.verifiedBy,
      },
      p_now: new Date().toISOString(),
    });
    if (saved.error || !saved.data) throw new Error(`owner pickup save failed: ${saved.error?.message ?? 'no row'}`);
    const { data, error } = await this.db.from('delivery_addresses').select(PICKUP_COLS).eq('id', String(saved.data)).maybeSingle();
    if (error || !data) throw new Error(`owner pickup read-back failed: ${error?.message ?? 'no row'}`);
    return { ok: true, address: toView(data as Row) };
  }

  /** Remove the owner's pickup address (retired; purged by retention once no leg needs it). */
  async remove(ownerId: string): Promise<{ ok: true } | { ok: false; code: 'leg_in_progress' }> {
    if (await this.hasLiveLeg(ownerId)) return { ok: false, code: 'leg_in_progress' };
    const { error } = await this.db.from('delivery_addresses').update({ retired_at: new Date().toISOString() }).eq('user_id', ownerId).eq('purpose', 'owner_pickup').is('retired_at', null);
    if (error) throw new Error(`owner pickup remove failed: ${error.message}`);
    return { ok: true };
  }

  /** The owner's community listings with their pickup opt-in. */
  async listings(ownerId: string): Promise<{ rentalId: string; title: string; live: boolean; ownerPickup: boolean }[]> {
    const { data, error } = await this.db
      .from('smart_rentals')
      .select('id, title, listing_status, is_published, listing_private(owner_pickup)')
      .eq('owner_id', ownerId)
      .eq('owner_type', 'community')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(`owner listings lookup failed: ${error.message}`);
    return ((data ?? []) as Row[]).map((r) => {
      const lp = (Array.isArray(r.listing_private) ? r.listing_private[0] : r.listing_private) as Row | null;
      return { rentalId: String(r.id), title: String(r.title ?? ''), live: r.listing_status === 'published' || (r.listing_status == null && r.is_published === true), ownerPickup: lp?.owner_pickup === true };
    });
  }

  /** Turn "available for pickup from my address" on or off for one of the owner's own listings. */
  async setListingPickup(ownerId: string, rentalId: string, enabled: boolean): Promise<{ ok: true } | { ok: false; code: 'not_found' | 'leg_in_progress' }> {
    const own = await this.db.from('smart_rentals').select('id').eq('id', rentalId).eq('owner_id', ownerId).eq('owner_type', 'community').maybeSingle();
    if (own.error) throw new Error(`owner listing lookup failed: ${own.error.message}`);
    if (!own.data) return { ok: false, code: 'not_found' };
    if (!enabled && (await this.hasLiveLeg(ownerId))) {
      // Switching off while a pickup is booked would strand it: staff change it with the owner.
      const { data, error } = await this.db
        .from('delivery_shipments')
        .select('status, accepted_at')
        .eq('origin_owner_id', ownerId)
        .contains('equipment_ids', [rentalId])
        .not('status', 'in', `(${FINAL_DELIVERY_STATES.join(',')})`)
        .or('status.neq.delivered,accepted_at.is.null')
        .limit(1);
      if (error) throw new Error(`owner listing legs lookup failed: ${error.message}`);
      if (((data ?? []) as Row[]).some((r) => LIVE_LEG(String(r.status), r.accepted_at))) return { ok: false, code: 'leg_in_progress' };
    }
    // updated_at is left alone: it versions the owner's listing edits, and a toggle must not 409 an edit.
    const { error } = await this.db.from('listing_private').upsert({ rental_id: rentalId, owner_pickup: enabled }, { onConflict: 'rental_id' });
    if (error) throw new Error(`owner pickup opt-in failed: ${error.message}`);
    return { ok: true };
  }
}

/**
 * Where each listing's gear is collected from. One read per table; anything
 * missing or unreadable answers "our site" for that listing (never an owner's
 * address by default). Before migration 080 every listing is our site.
 */
export class SupabaseDeliveryOrigins implements DeliveryOriginPort {
  constructor(private db: Admin = createAdminClient()) {}

  async originsFor(rentalIds: readonly string[]): Promise<Map<string, OwnerPickupDecision>> {
    const out = new Map<string, OwnerPickupDecision>();
    const ids = [...new Set(rentalIds)];
    if (ids.length === 0) return out;
    const listings = await this.db.from('smart_rentals').select('id, owner_type, owner_id, listing_status, is_published, listing_private(owner_pickup)').in('id', ids);
    if (listings.error) {
      if (isMissingPipeline(listings.error) || /owner_pickup/.test(listings.error.message ?? '')) return out;
      throw new Error(`delivery origins: ${listings.error.message}`);
    }
    const rows = (listings.data ?? []) as Row[];
    const owners = [...new Set(rows.map((r) => str(r.owner_id)).filter((x): x is string => !!x && rows.some((y) => y.owner_id === x && y.owner_type === 'community')))];
    const profiles = new Map<string, Row>();
    const addresses = new Map<string, Row>();
    if (owners.length > 0) {
      const [p, a] = await Promise.all([
        this.db.from('profiles').select('id, verification_status, is_suspended, suspension_expires_at').in('id', owners),
        this.db.from('delivery_addresses').select('id, user_id, province').eq('purpose', 'owner_pickup').is('retired_at', null).is('redacted_at', null).in('user_id', owners),
      ]);
      if (p.error) throw new Error(`delivery origins (owners): ${p.error.message}`);
      if (a.error) {
        if (!(isMissingPipeline(a.error) || /retired_at|owner_pickup/.test(a.error.message ?? ''))) throw new Error(`delivery origins (addresses): ${a.error.message}`);
      }
      for (const r of (p.data ?? []) as Row[]) profiles.set(String(r.id), r);
      for (const r of (a.error ? [] : ((a.data ?? []) as Row[]))) addresses.set(String(r.user_id), r);
    }
    const now = Date.now();
    for (const r of rows) {
      const ownerId = str(r.owner_id);
      const prof = ownerId ? profiles.get(ownerId) : undefined;
      const addr = ownerId ? addresses.get(ownerId) : undefined;
      const lp = (Array.isArray(r.listing_private) ? r.listing_private[0] : r.listing_private) as Row | null;
      const suspendedUntil = prof?.suspension_expires_at ? new Date(String(prof.suspension_expires_at)).getTime() : null;
      out.set(
        String(r.id),
        ownerPickupDecision({
          community: r.owner_type === 'community',
          ownerId,
          listingLive: r.listing_status === 'published' || (r.listing_status == null && r.is_published === true),
          listingOptIn: lp?.owner_pickup === true,
          ownerVerified: prof?.verification_status === 'verified',
          ownerSuspended: prof?.is_suspended === true && !(suspendedUntil !== null && suspendedUntil < now),
          address: addr ? { id: String(addr.id), province: str(addr.province) } : null,
        }),
      );
    }
    return out;
  }
}
