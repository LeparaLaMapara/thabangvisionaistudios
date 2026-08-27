import { describe, it, expect } from 'vitest';
import {
  calculateCancellationRefund,
  calculateServiceCancellationRefund,
  isCancellableStatus,
} from '@/lib/rental/cancellation';

/** Fixed reference point so the tests never depend on the wall clock. */
const NOW = new Date('2026-09-01T12:00:00.000Z');

function hoursFromNow(h: number): string {
  return new Date(NOW.getTime() + h * 60 * 60 * 1000).toISOString();
}

describe('calculateCancellationRefund', () => {
  it('refunds the full hire more than 48 hours before the start', () => {
    const q = calculateCancellationRefund({
      startDate: hoursFromNow(72),
      totalPrice: 2000,
      depositAmount: 1500,
      now: NOW,
    });
    expect(q.refundPercent).toBe(100);
    expect(q.hireRefund).toBe(2000);
    expect(q.cancellationFee).toBe(0);
    expect(q.totalRefund).toBe(3500); // hire + deposit
  });

  it('refunds half the hire between 24 and 48 hours before', () => {
    const q = calculateCancellationRefund({
      startDate: hoursFromNow(36),
      totalPrice: 2000,
      depositAmount: 1500,
      now: NOW,
    });
    expect(q.refundPercent).toBe(50);
    expect(q.hireRefund).toBe(1000);
    expect(q.cancellationFee).toBe(1000);
    expect(q.totalRefund).toBe(2500);
  });

  it('refunds none of the hire inside 24 hours', () => {
    const q = calculateCancellationRefund({
      startDate: hoursFromNow(6),
      totalPrice: 2000,
      depositAmount: 1500,
      now: NOW,
    });
    expect(q.refundPercent).toBe(0);
    expect(q.hireRefund).toBe(0);
    expect(q.cancellationFee).toBe(2000);
    expect(q.totalRefund).toBe(1500); // deposit only
  });

  it('always returns the deposit in full, even after the start date', () => {
    const q = calculateCancellationRefund({
      startDate: hoursFromNow(-10),
      totalPrice: 2000,
      depositAmount: 1500,
      now: NOW,
    });
    expect(q.refundPercent).toBe(0);
    expect(q.depositRefund).toBe(1500);
    expect(q.totalRefund).toBe(1500);
  });

  it('treats the 48 hour boundary as full refund', () => {
    const q = calculateCancellationRefund({
      startDate: hoursFromNow(48),
      totalPrice: 1000,
      depositAmount: 0,
      now: NOW,
    });
    expect(q.refundPercent).toBe(100);
  });

  it('treats the 24 hour boundary as half refund', () => {
    const q = calculateCancellationRefund({
      startDate: hoursFromNow(24),
      totalPrice: 1000,
      depositAmount: 0,
      now: NOW,
    });
    expect(q.refundPercent).toBe(50);
    expect(q.hireRefund).toBe(500);
  });

  it('never splits a rand into fractions of a cent', () => {
    const q = calculateCancellationRefund({
      startDate: hoursFromNow(30),
      totalPrice: 333.33,
      depositAmount: 0,
      now: NOW,
    });
    expect(q.hireRefund).toBe(166.67);
    expect(q.cancellationFee).toBe(166.66);
    expect(q.hireRefund + q.cancellationFee).toBeCloseTo(333.33, 2);
  });

  it('handles a zero-value booking without producing NaN', () => {
    const q = calculateCancellationRefund({
      startDate: hoursFromNow(72),
      totalPrice: 0,
      depositAmount: 0,
      now: NOW,
    });
    expect(q.totalRefund).toBe(0);
    expect(q.cancellationFee).toBe(0);
  });
});

describe('isCancellableStatus', () => {
  it('allows cancelling before the gear goes out', () => {
    expect(isCancellableStatus('pending')).toBe(true);
    expect(isCancellableStatus('confirmed')).toBe(true);
  });

  it('blocks cancelling once the hire is under way or closed', () => {
    for (const s of ['active', 'overdue', 'return_pending', 'completed', 'cancelled', 'disputed']) {
      expect(isCancellableStatus(s), s).toBe(false);
    }
  });
});

describe('calculateServiceCancellationRefund', () => {
  it('refunds a shoot in full with more than 48 hours notice', () => {
    const q = calculateServiceCancellationRefund({
      shootDate: hoursFromNow(72),
      total: 5000,
      now: NOW,
    });
    expect(q?.refundPercent).toBe(100);
    expect(q?.totalRefund).toBe(5000);
  });

  it('refunds half between 24 and 48 hours', () => {
    const q = calculateServiceCancellationRefund({
      shootDate: hoursFromNow(30),
      total: 5000,
      now: NOW,
    });
    expect(q?.refundPercent).toBe(50);
    expect(q?.totalRefund).toBe(2500);
  });

  it('refunds nothing inside 24 hours, when crew is committed', () => {
    const q = calculateServiceCancellationRefund({
      shootDate: hoursFromNow(5),
      total: 5000,
      now: NOW,
    });
    expect(q?.refundPercent).toBe(0);
    expect(q?.totalRefund).toBe(0);
  });

  it('never adds a deposit, because service bookings have none', () => {
    const q = calculateServiceCancellationRefund({
      shootDate: hoursFromNow(72),
      total: 5000,
      now: NOW,
    });
    expect(q?.depositRefund).toBe(0);
  });

  it('returns null when there is no shoot date, so a person decides', () => {
    expect(calculateServiceCancellationRefund({ shootDate: null, total: 5000, now: NOW })).toBeNull();
    expect(calculateServiceCancellationRefund({ shootDate: undefined, total: 5000, now: NOW })).toBeNull();
  });

  it('returns null for free text a person wrote instead of a date', () => {
    const q = calculateServiceCancellationRefund({
      shootDate: 'first week of March',
      total: 5000,
      now: NOW,
    });
    expect(q).toBeNull();
  });
});
