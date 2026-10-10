/**
 * Phase 5 (customer experience): the messages carry what the pages promise.
 * The checkout page says "you get a message with the collection details";
 * the confirmation and the reminder now carry them, and a delivered order is
 * never told its gear is "ready for collection".
 */
import { describe, expect, it } from 'vitest';
import { STUDIO } from '@/lib/constants';
import { collectionPointWithCity } from '@/lib/rental/collection-point';
import { noticeData, rentalNoticeText } from '@/lib/rental/notify';


describe('notices carry what the checkout page promised', () => {
  it('booking confirmed: collection details for a collection, delivery words for a delivery', () => {
    const c = rentalNoticeText('booking_confirmed', {});
    expect(c.body).toContain(collectionPointWithCity());
    expect(c.body).toContain(STUDIO.hours.weekday);
    const d = rentalNoticeText('booking_confirmed', { delivery: true });
    expect(d.body).not.toContain(collectionPointWithCity());
    expect(d.body).toMatch(/delivery/i);
  });

  it('the collection reminder says where', () => {
    expect(rentalNoticeText('collection_reminder', {}).body).toContain(collectionPointWithCity());
  });
});

describe('runReminders: "ready for collection" only for orders that are collected', () => {
  it('a delivered order gets no collection reminder; return reminders are unchanged', async () => {
    const { runReminders } = await import('@/lib/rental/workers');
    const enqueued: { kind: string; bookingIds: string[] }[] = [];
    const rows: Record<string, unknown>[] = [
      { id: 'collect-1', user_id: 'u1', status: 'confirmed', start_date: '2026-10-10', fulfilment_method: 'collection' },
      { id: 'legacy-1', user_id: 'u2', status: 'confirmed', start_date: '2026-10-10', fulfilment_method: null },
      { id: 'deliver-1', user_id: 'u3', status: 'confirmed', start_date: '2026-10-10', fulfilment_method: 'delivery' },
      { id: 'return-1', user_id: 'u4', status: 'active', end_date: '2026-10-11', fulfilment_method: 'delivery' },
    ];
    const db = {
      from: () => {
        const f: [string, unknown][] = [];
        const q = {
          select: () => q,
          eq: (k: string, v: unknown) => { f.push([k, v]); return q; },
          then: (resolve: (r: unknown) => void) => resolve({ data: rows.filter((r) => f.every(([k, v]) => r[k] === v)), error: null }),
        };
        return q;
      },
      rpc: async (_name: string, args: { p_notices: { kind: string; bookingIds: string[] }[] }) => {
        enqueued.push(...args.p_notices);
        return { error: null };
      },
    };
    const clock = { now: () => new Date('2026-10-10T05:45:00Z') };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await runReminders(db as any, clock);
    expect(r).toEqual({ collection: 2, returns: 1 });
    const collection = enqueued.filter((n) => n.kind === 'collection_reminder').flatMap((n) => n.bookingIds);
    expect([...new Set(collection)].sort()).toEqual(['collect-1', 'legacy-1']);
    expect(enqueued.some((n) => n.kind === 'return_reminder' && n.bookingIds.includes('return-1'))).toBe(true);
  });
});

describe('booking confirmed reads fulfilment_method, like the reminder', () => {
  const db = (rows: Record<string, unknown>[]) => ({
    from: () => {
      const q = { select: () => q, in: async () => ({ data: rows, error: null }) };
      return q;
    },
  });

  it('a delivered order is told about the delivery; a collected one where to collect', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = await noticeData(db([{ fulfilment_method: 'delivery' }]) as any, { kind: 'booking_confirmed', bookingIds: ['b1'], data: {} });
    expect(d.delivery).toBe(true);
    expect(rentalNoticeText('booking_confirmed', d).body).not.toContain(collectionPointWithCity());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = await noticeData(db([{ fulfilment_method: 'collection' }, { fulfilment_method: null }]) as any, { kind: 'booking_confirmed', bookingIds: ['b1', 'b2'], data: {} });
    expect(c.delivery).toBe(false);
    expect(rentalNoticeText('booking_confirmed', c).body).toContain(collectionPointWithCity());
  });

  it('a delivery fee alone does not decide it, and other notices are untouched', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = await noticeData(db([{ fulfilment_method: 'collection' }]) as any, { kind: 'booking_confirmed', bookingIds: ['b1'], data: { delivery: true } });
    expect(d.delivery).toBe(false);
    const other = { kind: 'refund_processed' as const, bookingIds: ['b1'], data: { amountCents: 100 } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await noticeData(db([]) as any, other)).toBe(other.data);
  });
});
