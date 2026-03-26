import { PRODUCTION_SERVICES } from '@/lib/constants';
import type { ProductionPackage, PackagePriceResult } from '@/types/production';

/**
 * Calculates the total price for a production package from PRODUCTION_SERVICES rates.
 * Prices are never hardcoded — they derive from hourly rates in constants.
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

  const vat = Math.round(subtotal * (PRODUCTION_SERVICES.billing.vatRate / 100));
  const total = subtotal + vat;

  return { subtotal, vat, total, lineItems };
}

/** Format a ZAR price for display: "R12,500" */
export function formatZAR(amount: number): string {
  return `R${amount.toLocaleString('en-ZA')}`;
}
