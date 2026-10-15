import { describe, it, expect } from 'vitest';
import { quoteHourly, quotePackage, packageUnitWords, splitServiceBooking } from '@/lib/bookings/pricing';
import type { TaxConfig } from '@/lib/core/pricing/tax';

// Not VAT-registered (STUDIO.legal.vatRegistered = false): no VAT is added,
// so the customer pays the advertised price. A legacy vatRate argument (15)
// passed by older callers is ignored.
describe('service booking prices', () => {
  it('charges a studio package its own price, no VAT added, whatever the hours', () => {
    // Family Birthday: R1 500 per project.
    const q = quotePackage(1500, 'project', 1, 15);
    expect(q).toMatchObject({ basis: 'package', subtotal: 1500, vat: 0, total: 1500, line: 'R1 500 a project' });
    expect(quotePackage(1500, 'project', 4, 15).total).toBe(1500);
  });

  it('multiplies a package priced per hour by the hours', () => {
    expect(quotePackage(900, 'hour', 3, 15)).toMatchObject({ subtotal: 2700, vat: 0, total: 2700 });
  });

  it('keeps the hourly quote as rate × hours', () => {
    expect(quoteHourly(1500, 2, 15)).toMatchObject({ basis: 'hourly', subtotal: 3000, vat: 0, total: 3000 });
    expect(quoteHourly(1500, 2)).toMatchObject({ subtotal: 3000, vat: 0, total: 3000 });
  });

  const registered: TaxConfig = { vatRegistered: true, vatRatePercent: 15, vatEffectiveFrom: '2027-03-01', pricesIncludeVat: true };

  it('a registration with a future effective date changes nothing before that date', () => {
    const q = quotePackage(1500, 'project', 1, 15, { at: new Date('2027-02-01'), tax: registered });
    expect(q).toMatchObject({ subtotal: 1500, vat: 0, total: 1500 });
  });

  it('after registration takes effect, VAT is carved out of the same price: the total does not rise', () => {
    const q = quotePackage(1500, 'project', 1, 15, { at: new Date('2027-04-01'), tax: registered });
    expect(q.total).toBe(1500);
    expect(q.vat).toBe(196); // 1500 × 15/115 = 195.65
    expect(q.subtotal + q.vat).toBe(q.total);
  });

  it('names the unit in plain words', () => {
    expect(packageUnitWords('session')).toBe('a session');
    expect(packageUnitWords('anything')).toBe('a project');
  });
});

describe('category packages are charged what their card shows', () => {
  it('books every listed package at the card total', async () => {
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

describe('splitServiceBooking: commission before VAT', () => {
  it('R1,000 shoot, not VAT-registered: customer pays R1,000, creator R850, we keep R150', () => {
    const q = quoteHourly(1000, 1, 15);
    const split = splitServiceBooking(q, 15);
    expect(q.total).toBe(1000);
    expect(q.vat).toBe(0);
    expect(split).toEqual({ platformAmount: 150, creatorAmount: 850 });
    expect(split.platformAmount + split.creatorAmount + q.vat).toBe(q.total);
  });

  it('after a VAT registration, commission is on the net price and VAT is never the creator\'s', () => {
    const tax: TaxConfig = { vatRegistered: true, vatRatePercent: 15, vatEffectiveFrom: '2027-03-01', pricesIncludeVat: true };
    const q = quoteHourly(1150, 1, undefined, { at: new Date('2027-06-01'), tax });
    expect(q).toMatchObject({ subtotal: 1000, vat: 150, total: 1150 });
    const split = splitServiceBooking(q, 15);
    expect(split).toEqual({ platformAmount: 150, creatorAmount: 850 });
    expect(split.platformAmount + split.creatorAmount + q.vat).toBe(q.total);
  });
});
