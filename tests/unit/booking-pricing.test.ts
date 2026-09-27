import { describe, it, expect } from 'vitest';
import { quoteHourly, quotePackage, packageUnitWords } from '@/lib/bookings/pricing';

describe('service booking prices', () => {
  it('charges a studio package its own price plus VAT, whatever the hours', () => {
    // Family Birthday: R1 500 per project, excl. VAT.
    const q = quotePackage(1500, 'project', 1, 15);
    expect(q).toMatchObject({ basis: 'package', subtotal: 1500, vat: 225, total: 1725, line: 'R1 500 per project' });
    expect(quotePackage(1500, 'project', 4, 15).total).toBe(1725);
  });

  it('multiplies a package priced per hour by the hours', () => {
    expect(quotePackage(900, 'hour', 3, 15)).toMatchObject({ subtotal: 2700, vat: 405, total: 3105 });
  });

  it('keeps the hourly quote as it was', () => {
    expect(quoteHourly(1500, 2, 15)).toMatchObject({ basis: 'hourly', subtotal: 3000, vat: 450, total: 3450 });
  });

  it('names the unit in plain words', () => {
    expect(packageUnitWords('session')).toBe('per session');
    expect(packageUnitWords('anything')).toBe('per project');
  });
});

describe('category packages are charged what their card shows', () => {
  it('books every listed package at the card total, incl. VAT', async () => {
    const { PRODUCTION_PACKAGES, STUDIO } = await import('@/lib/constants');
    const { calculatePackagePrice } = await import('@/lib/productions/pricing');
    const { getBookablePackage } = await import('@/lib/bookings/packages');
    for (const listed of PRODUCTION_PACKAGES) {
      const pkg = await getBookablePackage({} as never, listed.id);
      expect(pkg).not.toBeNull();
      const charged = quotePackage(pkg!.price, pkg!.priceUnit, pkg!.hours ?? 1, STUDIO.booking.vatRate);
      expect(charged.total).toBe(calculatePackagePrice(listed).total);
    }
  });

  it('refuses an unknown package id without touching the database', async () => {
    const { getBookablePackage } = await import('@/lib/bookings/packages');
    expect(await getBookablePackage({} as never, 'not-a-package')).toBeNull();
  });
});
