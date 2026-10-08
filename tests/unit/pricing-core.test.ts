import { describe, it, expect } from 'vitest';
import { allocateCents, bpsOf, fromCents, toCents, sumCents } from '@/lib/core/pricing/money';
import { priceWithVat, vatOnExclusive, vatOnInclusive, vatRateAt, currentTaxConfig, type TaxConfig } from '@/lib/core/pricing/tax';
import { quoteRental, quoteRentalBasket, hireCents, depositFor } from '@/lib/core/pricing/rental';
import { RENTAL_POLICY, STUDIO } from '@/lib/constants';
import { splitAcrossLines } from '@/lib/cart/pricing';

const R = (rands: number): number => toCents(rands);

describe('money: integer cents', () => {
  it('converts rands to cents without float drift', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(1.005)).toBe(101);
    expect(toCents(4500)).toBe(450000);
    expect(fromCents(450000)).toBe(4500);
    expect(() => fromCents(1.5)).toThrow();
    expect(() => toCents(Number.NaN)).toThrow();
  });

  it('takes basis points with half-up rounding', () => {
    expect(bpsOf(1000000, 2500)).toBe(250000);
    expect(bpsOf(1, 5000)).toBe(1); // 0.5c rounds up
    expect(bpsOf(-1, 5000)).toBe(-1);
  });

  it('allocates exactly, deterministically, by largest remainder', () => {
    expect(allocateCents(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateCents(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(allocateCents(5, [8000, 2000])).toEqual([4, 1]);
    expect(allocateCents(0, [1, 2])).toEqual([0, 0]);
    // Larger remainder wins the extra cent, not the earlier index.
    expect(allocateCents(10, [1, 2])).toEqual([3, 7]);
    for (const total of [1, 7, 99, 1001, 123457]) {
      const parts = allocateCents(total, [3, 5, 7, 11]);
      expect(sumCents(parts)).toBe(total);
    }
    expect(() => allocateCents(10, [])).toThrow();
    expect(() => allocateCents(10, [0, 0])).toThrow();
    expect(() => allocateCents(10, [1.5])).toThrow();
  });
});

describe('tax: VAT off while not registered', () => {
  it('the live config is not registered, so the rate is 0 today', () => {
    expect(STUDIO.legal.vatRegistered).toBe(false);
    expect(currentTaxConfig().vatRegistered).toBe(false);
    expect(vatRateAt()).toBe(0);
    expect(vatRateAt(new Date('2030-01-01'))).toBe(0);
  });

  it('no VAT is added or "included" when not registered', () => {
    expect(priceWithVat(R(1500))).toEqual({ ratePercent: 0, netCents: R(1500), vatCents: 0, grossCents: R(1500) });
  });

  const registered = (from: string | null, pricesIncludeVat = true): TaxConfig => ({
    vatRegistered: true,
    vatRatePercent: 15,
    vatEffectiveFrom: from,
    pricesIncludeVat,
  });

  it('registered but no effective date: still 0', () => {
    expect(vatRateAt(new Date('2027-01-01'), registered(null))).toBe(0);
  });

  it('registered with a FUTURE effective date: no VAT and no price increase before it', () => {
    const cfg = registered('2027-03-01');
    const before = new Date('2027-02-28T12:00:00+02:00');
    expect(vatRateAt(before, cfg)).toBe(0);
    expect(priceWithVat(R(1500), before, cfg).grossCents).toBe(R(1500));
  });

  it('after the effective date, prices are VAT-inclusive: the customer total never rises', () => {
    const cfg = registered('2027-03-01');
    const after = new Date('2027-03-01T00:00:00+02:00');
    expect(vatRateAt(after, cfg)).toBe(15);
    const b = priceWithVat(R(1150), after, cfg);
    expect(b.grossCents).toBe(R(1150));
    expect(b.vatCents).toBe(R(150));
    expect(b.netCents).toBe(R(1000));
  });

  it('VAT is only added on top if the config explicitly says prices exclude VAT', () => {
    const cfg = registered('2027-03-01', false);
    const b = priceWithVat(R(1000), new Date('2027-06-01'), cfg);
    expect(b.grossCents).toBe(R(1150));
  });

  it('inclusive/exclusive helpers', () => {
    expect(vatOnInclusive(R(1150), 15)).toBe(R(150));
    expect(vatOnExclusive(R(1000), 15)).toBe(R(150));
    expect(vatOnInclusive(R(1150), 0)).toBe(0);
  });
});

describe('rental quotes (RENTAL_POLICY: deposit 25% of replacement, owner 80 / platform 20)', () => {
  it('policy values', () => {
    expect(RENTAL_POLICY.depositRateBps).toBe(2500);
    expect(RENTAL_POLICY.ownerShareBps + RENTAL_POLICY.platformShareBps).toBe(10000);
  });

  it('worked example: R1,500/day × 3 days, replacement R10,000', () => {
    const q = quoteRental({ dailyRateCents: R(1500), days: 3, replacementValueCents: R(10000) });
    expect(q).toEqual({
      hireCents: R(4500),
      discountCents: 0,
      depositCents: R(2500),
      totalCents: R(7000),
      ownerShareCents: R(3600),
      platformShareCents: R(900),
    });
  });

  it('T01: daily rate × days for hires under a week', () => {
    expect(hireCents(R(500), R(2500), 6)).toBe(R(3000));
    expect(quoteRental({ dailyRateCents: R(500), days: 1, replacementValueCents: 0 }).hireCents).toBe(R(500));
    expect(() => hireCents(R(500), null, 0)).toThrow();
    expect(() => hireCents(R(500), null, 1.5)).toThrow();
  });

  it('T02: weekly rate for whole weeks plus daily remainder; daily only when no weekly rate', () => {
    expect(hireCents(R(500), R(2500), 10)).toBe(R(2500 + 3 * 500));
    expect(hireCents(R(500), null, 10)).toBe(R(5000));
    expect(hireCents(R(500), R(2500), 14)).toBe(R(5000));
  });

  it('T03: deposit is 25% of replacement value, refundable, outside the split', () => {
    expect(depositFor(R(10000))).toBe(R(2500));
    expect(depositFor(R(333.33))).toBe(8333); // 8333.25c → 8333c
    const q = quoteRental({ dailyRateCents: R(1000), days: 2, replacementValueCents: R(80000) });
    expect(q.depositCents).toBe(R(20000));
    expect(q.ownerShareCents + q.platformShareCents).toBe(q.hireCents - q.discountCents);
    expect(q.totalCents).toBe(q.hireCents - q.discountCents + q.depositCents);
  });

  it('T04: discount comes off the hire, and owner + platform equal the discounted hire exactly', () => {
    const q = quoteRental({ dailyRateCents: R(333.33), days: 3, replacementValueCents: R(5000), discountBps: 1000 });
    expect(q.hireCents).toBe(99999);
    expect(q.discountCents).toBe(10000); // 9999.9c → 10000c
    expect(q.ownerShareCents + q.platformShareCents).toBe(89999);
    expect(q.ownerShareCents).toBe(71999); // 71999.2c
    expect(q.platformShareCents).toBe(18000);
    expect(q.totalCents).toBe(89999 + R(1250));
    expect(() => quoteRental({ dailyRateCents: 100, days: 1, replacementValueCents: 0, discountBps: 10001 })).toThrow();
  });

  it('multi-item basket: line discounts, deposits and shares add up to the basket exactly', () => {
    const basket = quoteRentalBasket(
      [
        { dailyRateCents: R(333.33), days: 3, replacementValueCents: R(9999.99) },
        { dailyRateCents: R(111.11), days: 7, weeklyRateCents: R(555.55), replacementValueCents: R(1234.57), quantity: 2 },
        { dailyRateCents: R(77.77), days: 1, replacementValueCents: R(10.01) },
      ],
      1000,
    );
    expect(basket.lines).toHaveLength(3);
    expect(sumCents(basket.lines.map((l) => l.discountCents))).toBe(basket.discountCents);
    expect(basket.discountCents).toBe(bpsOf(basket.hireCents, 1000));
    for (const l of basket.lines) {
      expect(l.ownerShareCents + l.platformShareCents).toBe(l.hireCents - l.discountCents);
    }
    expect(basket.ownerShareCents + basket.platformShareCents).toBe(basket.hireCents - basket.discountCents);
    expect(basket.totalCents).toBe(basket.hireCents - basket.discountCents + basket.depositCents);
    expect(quoteRentalBasket([]).totalCents).toBe(0);
  });
});

describe('splitAcrossLines (cart checkout per-booking amounts)', () => {
  it('splits a total so the lines add up to it to the cent', () => {
    const parts = splitAcrossLines(100, 3);
    expect(parts).toEqual([33.34, 33.33, 33.33]);
    expect(toCents(parts.reduce((a, b) => a + b, 0))).toBe(10000);
    // The old round(total / n) gave 3 × 33.33 = 99.99.
  });

  it('splits proportionally by line amounts', () => {
    const parts = splitAcrossLines(1350, [1000, 500]);
    expect(parts).toEqual([900, 450]);
    const odd = splitAcrossLines(1234.57, [333.33, 333.33, 333.34]);
    expect(sumCents(odd.map(toCents))).toBe(123457);
  });

  it('handles zero lines and all-zero weights', () => {
    expect(splitAcrossLines(100, 0)).toEqual([]);
    expect(sumCents(splitAcrossLines(10, [0, 0]).map(toCents))).toBe(1000);
  });
});

describe('no VAT anywhere while not registered', () => {
  it('package prices: total = sum of lines, VAT 0', async () => {
    const { PRODUCTION_PACKAGES } = await import('@/lib/constants');
    const { calculatePackagePrice } = await import('@/lib/productions/pricing');
    for (const pkg of PRODUCTION_PACKAGES) {
      const p = calculatePackagePrice(pkg);
      expect(p.vat).toBe(0);
      expect(p.total).toBe(p.lineItems.reduce((s, l) => s + l.amount, 0));
    }
  });

  it('the quote PDF totals carry no VAT', async () => {
    const { quoteTotals } = await import('@/lib/pdf/quote');
    expect(quoteTotals([{ total: 1000 }, { total: 250.5 }])).toEqual({ subtotal: 1250.5, vatAmount: 0, total: 1250.5, vatRate: 0 });
  });

  it('the cart discloses no included VAT', async () => {
    const { calculateIncludedVat, currentVatRate } = await import('@/lib/cart/pricing');
    expect(calculateIncludedVat(1350)).toBe(0);
    expect(currentVatRate()).toBe(0);
  });

  it('SERVICE_VAT_RATE is 0', async () => {
    const { SERVICE_VAT_RATE, withServiceVat } = await import('@/lib/format/money');
    expect(SERVICE_VAT_RATE).toBe(0);
    expect(withServiceVat(1234.5)).toBe(1234.5);
  });
});
