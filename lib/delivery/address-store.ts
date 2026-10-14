import { STUDIO } from '@/lib/constants';
import { createAdminClient } from '@/lib/supabase/server';
import { exactCollectionPointWithCity } from '@/lib/rental/collection-point';
import type { VerifiedAddress } from './address';

/**
 * Writes verified addresses to delivery_addresses (migration 076). Service
 * role only: the table is readable by the person whose address it is and the
 * server, never by owners or other users (D21). Rows are written only after
 * the AddressPort verified the address on the server.
 */

type Admin = ReturnType<typeof createAdminClient>;

export interface RenterAddressInput {
  userId: string;
  address: VerifiedAddress;
  verifiedBy: string;
  /** First name (or business name) and phone, for the driver only. */
  contactName: string;
  contactPhone: string;
  instructions: string | null;
}

export interface DeliveryAddressWriter {
  /** Store (or reuse) a verified renter address. Returns its id. */
  saveRenterAddress(p: RenterAddressInput): Promise<string>;
  /** Our dispatch site as a delivery_addresses row (created once). */
  platformSiteId(): Promise<string>;
}

/** Our dispatch site, from STUDIO constants (never from a browser). */
export function platformSiteRow(): Record<string, unknown> {
  const f = STUDIO.fulfilment.dispatchFrom;
  return {
    user_id: null,
    purpose: 'platform_site',
    formatted_address: exactCollectionPointWithCity(),
    suburb: f.name,
    city: STUDIO.location.city,
    province: STUDIO.serviceArea.province,
    postal_code: null,
    lat: f.lat,
    lng: f.lng,
    contact_name: STUDIO.name,
    contact_phone: STUDIO.phone,
    instructions: null,
    verified_by: 'platform_constants',
  };
}

export class SupabaseDeliveryAddressWriter implements DeliveryAddressWriter {
  private siteId: string | null = null;
  constructor(private db: Admin = createAdminClient()) {}

  async saveRenterAddress(p: RenterAddressInput): Promise<string> {
    // The same verified address and contact again (a re-quote) reuses the row.
    const { data: existing, error: findErr } = await this.db
      .from('delivery_addresses')
      .select('id')
      .eq('user_id', p.userId)
      .eq('purpose', 'renter_address')
      .eq('formatted_address', p.address.formattedAddress)
      .eq('lat', p.address.lat)
      .eq('lng', p.address.lng)
      .eq('contact_name', p.contactName)
      .eq('contact_phone', p.contactPhone)
      .is('redacted_at', null)
      .limit(1);
    if (findErr) throw new Error(`delivery address lookup failed: ${findErr.message}`);
    const found = (existing ?? [])[0] as { id: string } | undefined;
    if (found && p.instructions === null) return found.id;
    if (found) {
      await this.db.from('delivery_addresses').update({ instructions: p.instructions }).eq('id', found.id);
      return found.id;
    }
    const { data, error } = await this.db
      .from('delivery_addresses')
      .insert({
        user_id: p.userId,
        purpose: 'renter_address',
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
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`delivery address insert failed: ${error?.message ?? 'no row'}`);
    return String((data as { id: string }).id);
  }

  async platformSiteId(): Promise<string> {
    if (this.siteId) return this.siteId;
    const row = platformSiteRow();
    const { data, error } = await this.db
      .from('delivery_addresses')
      .select('id')
      .eq('purpose', 'platform_site')
      .eq('formatted_address', row.formatted_address as string)
      .eq('lat', row.lat as number)
      .eq('lng', row.lng as number)
      .is('redacted_at', null)
      .limit(1);
    if (error) throw new Error(`platform site lookup failed: ${error.message}`);
    const found = (data ?? [])[0] as { id: string } | undefined;
    if (found) return (this.siteId = found.id);
    const ins = await this.db.from('delivery_addresses').insert(row).select('id').single();
    if (ins.error || !ins.data) throw new Error(`platform site insert failed: ${ins.error?.message ?? 'no row'}`);
    return (this.siteId = String((ins.data as { id: string }).id));
  }
}
