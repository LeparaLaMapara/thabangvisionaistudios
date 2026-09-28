import { calculatePackagePrice } from '@/lib/productions/pricing';
import type { ProductionPackage } from '@/types/production';

/**
 * The "From" price on a studio category page: the cheapest package a customer
 * can actually request on that page, including VAT (calculatePackagePrice
 * already adds it), or null when nothing on the page has a price.
 *
 * It used to print PRODUCTION_CATEGORIES.startingRate, which is an hourly
 * rate excluding VAT: "From R9 000" above a wedding package of R47 495.
 */
export function categoryFromPrice(packages: readonly ProductionPackage[]): number | null {
  const totals = packages.map((p) => calculatePackagePrice(p).total).filter((t) => t > 0);
  return totals.length > 0 ? Math.min(...totals) : null;
}
