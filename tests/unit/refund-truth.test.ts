import { describe, it, expect } from 'vitest';
import {
  bulkDiscountPercentFor,
  calculateCancellationRefund,
  calculateServiceCancellationRefund,
  paidOnlineForLine,
  startOfBookedDay,
} from '@/lib/rental/cancellation';
import { payoutBlocker } from '@/lib/payments/payout';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const daysAgo = (d: number): string => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const hoursFromNow = (h: number): string => new Date(NOW.getTime() + h * 3_600_000).toISOString();

describe('7 day cooling off (Refunds section 10)', () => {
  it('refunds everything when booked 2 days ago, even 10 hours before the start', () => {
    const q = calculateCancellationRefund({
      startDate: hoursFromNow(10), totalPrice: 1000, depositAmount: 500, deliveryFee: 120,
      bookedAt: daysAgo(2), now: NOW,
    });
    expect(q.coolingOff).toBe(true);
    expect(q.refundPercent).toBe(100);
    expect(q.totalRefund).toBe(1620);
  });

  it('ends after 7 days: the normal scale applies', () => {
    const q = calculateCancellationRefund({
      startDate: hoursFromNow(10), totalPrice: 1000, depositAmount: 0,
      bookedAt: daysAgo(8), now: NOW,
    });
    expect(q.coolingOff).toBe(false);
    expect(q.refundPercent).toBe(0);
  });

  it('ends once the hire has started', () => {
    const q = calculateCancellationRefund({
      startDate: hoursFromNow(-1), totalPrice: 1000, depositAmount: 0,
      bookedAt: daysAgo(1), now: NOW,
    });
    expect(q.coolingOff).toBe(false);
  });

  it('applies to service bookings too', () => {
    const q = calculateServiceCancellationRefund({
      shootDate: hoursFromNow(5), total: 3000, bookedAt: daysAgo(3), now: NOW,
    });
    expect(q?.totalRefund).toBe(3000);
  });

  it('is off when the booking time is unknown', () => {
    const q = calculateCancellationRefund({
      startDate: hoursFromNow(5), totalPrice: 1000, depositAmount: 0, now: NOW,
    });
    expect(q.coolingOff).toBe(false);
  });
});

describe('paidOnlineForLine: refund only what reached the card', () => {
  it('listing booking: hire paid online, deposit paid at collection', () => {
    expect(paidOnlineForLine({ totalPrice: 900, depositAmount: 2000 }))
      .toEqual({ hire: 900, deposit: 0, delivery: 0 });
  });

  it('cart deposit only: just the deposit', () => {
    expect(paidOnlineForLine({ totalPrice: 900, depositAmount: 2000, paymentPlan: 'deposit_only', checkoutGroupId: 'g' }))
      .toEqual({ hire: 0, deposit: 2000, delivery: 0 });
  });

  it('cart in full: hire less the bulk discount, deposit and delivery', () => {
    expect(paidOnlineForLine({ totalPrice: 1000, depositAmount: 500, deliveryFee: 150, paymentPlan: 'full', checkoutGroupId: 'g', discountPercent: 10 }))
      .toEqual({ hire: 900, deposit: 500, delivery: 150 });
  });

  it('bulk discount matches the cart rule', () => {
    expect(bulkDiscountPercentFor(2)).toBe(0);
    expect(bulkDiscountPercentFor(3)).toBe(10);
    expect(bulkDiscountPercentFor(9)).toBe(20);
  });
});

describe('start of a booked day', () => {
  it('is midnight in South Africa, not 02:00', () => {
    expect(startOfBookedDay('2026-10-05').toISOString()).toBe('2026-10-04T22:00:00.000Z');
  });
});

describe('payout needs a verified creator', () => {
  const booking = {
    status: 'completed', payment_status: 'paid', payout_status: 'pending',
    creator_id: 'c', creator_amount: 850, total: 1000,
  };
  it('refuses when the ID check has not passed', () => {
    expect(payoutBlocker(booking, { success: true, amount: 1000 }, false)).toMatch(/ID check/);
  });
  it('allows a verified creator', () => {
    expect(payoutBlocker(booking, { success: true, amount: 1000 }, true)).toBeNull();
  });
});
