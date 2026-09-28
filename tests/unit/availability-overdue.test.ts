import { describe, it, expect } from 'vitest';
import { checkAvailability } from '@/lib/rental/availability';

describe('gear that is out counts as taken', () => {
  it('an overdue hire still occupies the only unit', () => {
    const r = checkAvailability({
      stock: 1,
      requested: 1,
      holds: [{ id: 'a', quantity: 1, status: 'overdue', createdAt: '2026-09-01T00:00:00Z', paymentReference: 'ref' }],
    });
    expect(r.available).toBe(false);
  });
  it('an unpaid request holds its dates for as long as the hold window says', () => {
    const now = new Date('2026-09-28T12:00:00Z');
    const hold = { id: 'b', quantity: 1, status: 'pending', createdAt: '2026-09-28T10:00:00Z', paymentReference: null };
    expect(checkAvailability({ stock: 1, requested: 1, holds: [hold], now, holdMinutes: 30 }).available).toBe(true);
    expect(checkAvailability({ stock: 1, requested: 1, holds: [hold], now, holdMinutes: 48 * 60 }).available).toBe(false);
  });
});
