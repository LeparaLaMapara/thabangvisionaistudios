import { PRODUCTION_SERVICES } from '@/lib/constants';
import { serviceVat } from '@/lib/bookings/pricing';
import type { ProductionPackage, PackagePriceResult } from '@/types/production';

/**
 * Calculates the total price for a production package from PRODUCTION_SERVICES rates.
 * Prices are never hardcoded — they derive from hourly rates in constants.
 * `total` is what the customer pays; no VAT is added on top.
 */
export function calculatePackagePrice(pkg: ProductionPackage): PackagePriceResult {
  const lineItems: PackagePriceResult['lineItems'] = [];
  let subtotal = 0;

  for (const service of pkg.services) {
    const serviceGroup = PRODUCTION_SERVICES[service.type] as Record<
      string,
      { rate: number; unit: string; description: string }
    >;
    const serviceConfig = serviceGroup[service.subType];
    if (!serviceConfig) continue;

    const amount = serviceConfig.rate * service.hours;
    subtotal += amount;
    lineItems.push({
      service: serviceConfig.description,
      hours: service.hours,
      rate: serviceConfig.rate,
      amount,
    });
  }

  // VAT from the tax core, the same rule the booking API charges by: 0 while
  // not VAT-registered, so total = the sum of the lines. After a registration
  // the price is treated as VAT-inclusive (subtotal becomes the net amount).
  const priced = serviceVat(subtotal);

  return { subtotal: priced.subtotal, vat: priced.vat, total: priced.total, lineItems };
}

/** Format a ZAR price for display: "R12,500" or "R 12,500.00" with decimals */
export function formatZAR(amount: number, opts?: { decimals?: boolean; space?: boolean }): string {
  const prefix = opts?.space ? 'R ' : 'R';
  const formatted = opts?.decimals
    ? amount.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : amount.toLocaleString('en-ZA');
  return `${prefix}${formatted}`;
}
