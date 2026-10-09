/**
 * Finding 13: the overdue ladder respects a return pickup. Gear the return
 * pickup took from the renter before the return time is never marked
 * overdue; once collected, no further escalation is sent (the gear is on its
 * way back). Bookings with no return pickup keep the old behaviour.
 */
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  collected: new Map<string, string>(),
  transitions: [] as string[],
  notices: [] as { kind: string; bookingIds: string[] }[],
}));

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/payments/ports', () => ({ paymentPort: {}, payoutPort: {} }));
vi.mock('@/lib/analytics/funnel', () => ({ trackFunnel: vi.fn() }));
vi.mock('@/lib/delivery/after-payment', () => ({ afterRentalPayment: async () => ({ outcome: 'no_delivery' }) }));
vi.mock('@/lib/rental/delivery-settlement', () => ({
  deliverySettlement: async () => ({ allowed: true, reasons: [], lateFeeAutoCharge: true, returnCollectedAt: null }),
  returnCollectedAt: async (_db: unknown, ids: string[]) => new Map(ids.filter((i) => h.collected.has(i)).map((i) => [i, h.collected.get(i) as string])),
}));
vi.mock('@/lib/rental/repos', async (orig) => ({
  ...(await orig<typeof import('@/lib/rental/repos')>()),
  transitionBookings: async (_db: unknown, t: { ids: string[] }) => {
    h.transitions.push(...t.ids);
    return { result: 'moved' };
  },
}));

const ACTIVE = [
  { id: 'on-time-pickup', end_date: '2026-10-20' },
  { id: 'no-pickup', end_date: '2026-10-20' },
  { id: 'late-pickup', end_date: '2026-10-20' },
];
const OVERDUE = [
  { id: 'overdue-collected', user_id: 'u1', end_date: '2026-10-18' },
  { id: 'overdue-not-collected', user_id: 'u2', end_date: '2026-10-18' },
];

function db() {
  return {
    rpc: async (_name: string, args: { p_notices: { kind: string; bookingIds: string[] }[] }) => {
      h.notices.push(...(args.p_notices ?? []));
      return { data: null, error: null };
    },
    from(table: string) {
      let status = '';
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'lt', 'in', 'update']) b[m] = () => b;
      b.eq = (c: string, v: string) => {
        if (c === 'status') status = v;
        return b;
      };
      b.upsert = async () => ({ error: null });
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: table === 'equipment_bookings' ? (status === 'active' ? ACTIVE : OVERDUE) : [], error: null }).then(resolve);
      return b;
    },
  };
}

describe('overdue ladder with return pickups (finding 13)', () => {
  it('collected in time: never overdue; collected late: overdue but not chased; not collected: as before', async () => {
    const { runOverdueLadder } = await import('@/lib/rental/workers');
    h.collected = new Map([
      ['on-time-pickup', '2026-10-20T13:00:00.000Z'],
      ['late-pickup', '2026-10-21T13:00:00.000Z'],
      ['overdue-collected', '2026-10-19T09:00:00.000Z'],
    ]);
    const now = new Date('2026-10-23T08:00:00.000Z');
    await runOverdueLadder(db() as never, { now: () => now });
    expect(h.transitions).toEqual(['no-pickup', 'late-pickup']);
    const chased = new Set(h.notices.flatMap((n) => n.bookingIds));
    expect(chased.has('overdue-collected')).toBe(false);
    expect(chased.has('overdue-not-collected')).toBe(true);
  });
});
