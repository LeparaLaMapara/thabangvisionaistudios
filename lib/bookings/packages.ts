import type { SupabaseClient } from '@supabase/supabase-js';
import { PRODUCTION_PACKAGES, STUDIO } from '@/lib/constants';
import { calculatePackagePrice } from '@/lib/productions/pricing';

/** A studio package someone can book, as read on the server (never from the browser). */
export interface BookablePackage {
  id: string;
  title: string;
  price: number;
  priceUnit: string;
  creatorId: string | null;
  /** Hours of work in the package, for scheduling (fixed-price packages). */
  hours?: number;
}

/**
 * A bookable package by id, or null:
 * - a studio category package from PRODUCTION_PACKAGES (e.g. "headshot-session"),
 *   priced by calculatePackagePrice, the same numbers the category page shows;
 * - a published, priced, not deleted studio item from smart_productions (a uuid).
 */
export async function getBookablePackage(
  supabase: SupabaseClient,
  id: string,
): Promise<BookablePackage | null> {
  const listed = PRODUCTION_PACKAGES.find((p) => p.id === id);
  if (listed) {
    const price = calculatePackagePrice(listed);
    const hours = listed.services.reduce((sum, s) => sum + s.hours, 0);
    return {
      id: listed.id,
      title: listed.name,
      price: price.subtotal, // excl. VAT; VAT is added the same way for every service
      priceUnit: 'project',
      creatorId: null,
      hours: Math.min(Math.max(hours, STUDIO.booking.minBookingHours), STUDIO.booking.maxBookingHours),
    };
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await supabase
    .from('smart_productions')
    .select('id, title, price, price_unit, creator_id, is_published, deleted_at')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('[packages] read failed:', error.message);
    return null;
  }
  if (!data || !data.is_published || data.deleted_at || !data.price || data.price <= 0) return null;
  return {
    id: data.id,
    title: data.title,
    price: data.price,
    priceUnit: data.price_unit ?? 'project',
    creatorId: data.creator_id ?? null,
  };
}
