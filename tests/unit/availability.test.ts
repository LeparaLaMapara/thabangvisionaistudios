import { describe, it, expect } from 'vitest';
import {
  isExpiredHold,
  bookedUnits,
  checkAvailability,
  availabilityMessage,
  type BookingHold,
} from '@/lib/rental/availability';
import { STUDIO } from '@/lib/constants';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const HOLD = STUDIO.rental.pendingHoldMinutes;
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const hold = (over: Partial<BookingHold> = {}): BookingHold => ({
  id: 'b1',
  quantity: 1,
  status: 'pending',
  createdAt: minsAgo(1),
  paymentReference: null,
  ...over,
});

describe('isExpiredHold', () => {
  it('expires an unpaid checkout left past the window', () => {
    expect(isExpiredHold(hold({ createdAt: minsAgo(HOLD + 1) }), NOW)).toBe(true);
  });

  it('keeps a fresh unpaid checkout, so nobody loses a booking mid-payment', () => {
    expect(isExpiredHold(hold({ createdAt: minsAgo(HOLD - 1) }), NOW)).toBe(false);
  });

  it('NEVER expires a paid booking still sitting in pending', () => {
    // A paid booking waits in 'pending' until the webhook lands. Releasing it
    // would sell the same gear twice, and the reconciliation bug earlier this
    // week produced exactly these rows.
    expect(isExpiredHold(
      hold({ createdAt: minsAgo(HOLD * 100), paymentReference: 'ref_123' }), NOW,
    )).toBe(false);
  });

  it('never expires a confirmed or active booking', () => {
    for (const status of ['confirmed', 'active', 'return_pending']) {
      expect(isExpiredHold(hold({ status, createdAt: minsAgo(HOLD * 100) }), NOW), status).toBe(false);
    }
  });

  it('does not free stock on an unparseable timestamp', () => {
    expect(isExpiredHold(hold({ createdAt: 'not-a-date' }), NOW)).toBe(false);
  });
});

describe('bookedUnits', () => {
  it('sums units rather than counting bookings', () => {
    expect(bookedUnits([
      hold({ id: 'a', quantity: 2, status: 'confirmed' }),
      hold({ id: 'b', quantity: 1, status: 'active' }),
    ], NOW)).toBe(3);
  });

  it('ignores released statuses', () => {
    expect(bookedUnits([
      hold({ id: 'a', quantity: 5, status: 'cancelled' }),
      hold({ id: 'b', quantity: 3, status: 'completed' }),
    ], NOW)).toBe(0);
  });

  it('ignores expired holds so abandoned baskets stop blocking stock', () => {
    expect(bookedUnits([
      hold({ id: 'a', quantity: 2, createdAt: minsAgo(HOLD + 60) }),
    ], NOW)).toBe(0);
  });

  it('treats a missing quantity as one unit', () => {
    expect(bookedUnits([
      hold({ quantity: 0 as unknown as number, status: 'confirmed' }),
    ], NOW)).toBe(1);
  });
});

describe('checkAvailability', () => {
  it('lets a second customer book the second camera', () => {
    // The defect this whole module exists for: two units in stock, one booked,
    // and the old check refused the second customer outright.
    const r = checkAvailability({
      stock: 2,
      holds: [hold({ quantity: 1, status: 'confirmed' })],
      requested: 1,
      now: NOW,
    });
    expect(r.available).toBe(true);
    expect(r.remaining).toBe(1);
  });

  it('refuses the third when both cameras are out', () => {
    const r = checkAvailability({
      stock: 2,
      holds: [
        hold({ id: 'a', quantity: 1, status: 'confirmed' }),
        hold({ id: 'b', quantity: 1, status: 'active' }),
      ],
      requested: 1,
      now: NOW,
    });
    expect(r.available).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it('refuses a request larger than remaining stock', () => {
    const r = checkAvailability({ stock: 2, holds: [], requested: 5, now: NOW });
    expect(r.available).toBe(false);
    expect(r.remaining).toBe(2);
  });

  it('frees stock once an abandoned hold expires', () => {
    const abandoned = [hold({ quantity: 1, createdAt: minsAgo(HOLD + 5) })];
    expect(checkAvailability({ stock: 1, holds: abandoned, requested: 1, now: NOW }).available).toBe(true);
  });

  it('still blocks while that hold is fresh', () => {
    const active = [hold({ quantity: 1, createdAt: minsAgo(1) })];
    expect(checkAvailability({ stock: 1, holds: active, requested: 1, now: NOW }).available).toBe(false);
  });

  it('treats a listing with no quantity as a single unit', () => {
    const r = checkAvailability({
      stock: undefined as unknown as number, holds: [], requested: 1, now: NOW,
    });
    expect(r.stock).toBe(1);
    expect(r.available).toBe(true);
  });

  it('never reports negative remaining if stock was reduced under live bookings', () => {
    const r = checkAvailability({
      stock: 1,
      holds: [
        hold({ id: 'a', quantity: 2, status: 'confirmed' }),
        hold({ id: 'b', quantity: 2, status: 'active' }),
      ],
      requested: 1,
      now: NOW,
    });
    expect(r.remaining).toBe(0);
    expect(r.available).toBe(false);
  });
});

describe('availabilityMessage', () => {
  it('says fully booked when nothing is left', () => {
    const r = checkAvailability({ stock: 1, holds: [hold({ status: 'confirmed' })], requested: 1, now: NOW });
    expect(availabilityMessage('Sony FX3', r)).toMatch(/fully booked/i);
  });

  it('tells the customer how many they could actually have', () => {
    const r = checkAvailability({ stock: 3, holds: [hold({ quantity: 2, status: 'confirmed' })], requested: 2, now: NOW });
    expect(availabilityMessage('Sony FX3', r)).toContain('only 1 of 3');
  });
});
