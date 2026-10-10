/**
 * Phase 8 review fixes (collection from the owner's address). Each block
 * names the finding it covers; the P1, P2 and P3 money/custody ones were
 * mutation-checked (undoing the fix makes a test here fail). The database
 * side (column grants on delivery_quotes, the per-origin cancelled-order
 * sweep, the atomic pickup-address save) is in
 * lib/migrations/080-owner-pickup.test.sql (9, 10, 11, 3f).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DELIVERY_POLICY } from '@/lib/constants';
import { coarsePricingPoint } from '@/lib/core/delivery/origin';
import { ownerMayConfirmReturn, type CustodyEvent } from '@/lib/core/delivery/custody';
import type { DeliveryPort, DeliveryQuoteRequest } from '@/lib/core/delivery/port';
import type { Shipment } from '@/lib/core/delivery/repository';
import {
  advanceManualDelivery,
  checkRentalSettlement,
  confirmCollection,
  confirmHandover,
  confirmOwnerReturn,
  getDeliveryStatus,
  quoteDelivery,
  refundUnusedDeliveryQuote,
} from '@/lib/core/delivery/use-cases';
import { quoteOwnVehicleCents } from '@/lib/delivery/quote';
import { quoteCartDelivery } from '@/lib/delivery/checkout';
import { dispatchDeliveryAfterPayment } from '@/lib/delivery/after-payment';
import { customerLegs } from '@/lib/delivery/customer-view';
import { ownerLegs } from '@/lib/delivery/owner-view';
import { SupabaseOwnerPickup } from '@/lib/delivery/origins';
import { deliveryCancellationPlan, originsWithGearAtRenter } from '@/lib/rental/delivery-settlement';
import { GROUP, OFFICE, OWNER_A, OWNER_B, RENTER, RENTER_HOME, STAFF, registry } from './helpers/delivery-fakes';
import { BACK_WINDOW, LENS_A, MIXED_LINES, OUT_WINDOW, PICK_A, PICK_B, originWorld, type OriginWorld } from './helpers/delivery-origin-fakes';

const renter = { kind: 'renter' as const, userId: RENTER };
const staff = { kind: 'staff' as const, userId: STAFF };
const ownerA = { kind: 'owner' as const, userId: OWNER_A };
const PHOTO = [{ kind: 'photo' as const, ref: 'https://res.cloudinary.com/x/image/upload/v1/evidence.jpg' }];

const exactFee = (from: { lat: number; lng: number }, to: { lat: number; lng: number }): number => {
  const q = quoteOwnVehicleCents({ origin: { name: 'origin', coords: from }, destination: to, itemCount: 1 });
  if (!('feeCents' in q)) throw new Error('no fee');
  return q.feeCents;
};

/** Record every quote request the (manual) provider is asked for. */
function spyOnQuotes(w: OriginWorld): DeliveryQuoteRequest[] {
  const seen: DeliveryQuoteRequest[] = [];
  const real = w.manual;
  const spy: DeliveryPort = {
    ...real,
    quote: async (r) => {
      seen.push(r);
      return real.quote(r);
    },
  };
  w.deps.providers = registry([spy]);
  return seen;
}

async function quoteOne(w: OriginWorld, p: { leg: 'outbound' | 'return'; owner: string | null; ownerAddress: string; rentalIndex: number }): Promise<number> {
  const ownerSide = p.owner ? p.ownerAddress : OFFICE;
  const r = await quoteDelivery(
    {
      caller: renter,
      renterId: RENTER,
      bookingGroupId: GROUP,
      leg: p.leg,
      originAddressId: p.leg === 'outbound' ? ownerSide : RENTER_HOME,
      destinationAddressId: p.leg === 'outbound' ? RENTER_HOME : ownerSide,
      originOwnerId: p.owner,
      lines: [MIXED_LINES[p.rentalIndex]],
      window: p.leg === 'outbound' ? OUT_WINDOW : BACK_WINDOW,
    },
    w.deps,
  );
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.quotes[0].customerFeeCents;
}

// ── P1: an owner's home can never be trilaterated from the renter's fees ────

describe('P1: an owner-origin leg is priced from a coarse grid cell (D-93), the studio exactly', () => {
  // Two different houses in Hatfield, inside the same 0.02 degree cell.
  const HOUSE_1 = { lat: -25.7479, lng: 28.2293 };
  const HOUSE_2 = { lat: -25.7431, lng: 28.2376 };
  let w: OriginWorld;
  beforeEach(() => {
    w = originWorld();
  });

  it('the grid is a constant, and two points in one cell snap to the same centre (street and contact dropped)', () => {
    expect(DELIVERY_POLICY.ownerPickup.pricingGridDegrees).toBeGreaterThan(0);
    const a = coarsePricingPoint({ ...HOUSE_1, suburb: 'Hatfield', city: 'Pretoria', postalCode: '0083', province: 'Gauteng' });
    const b = coarsePricingPoint({ ...HOUSE_2, suburb: 'Hatfield', city: 'Pretoria', postalCode: '0083', province: 'Gauteng' });
    expect([a.lat, a.lng]).toEqual([b.lat, b.lng]);
    expect(a).toEqual({ lat: -25.75, lng: 28.23, suburb: 'Hatfield', city: 'Pretoria', postalCode: '0083', province: 'Gauteng' });
    // Never further from the real point than half a cell on each axis.
    const g = DELIVERY_POLICY.ownerPickup.pricingGridDegrees;
    expect(Math.abs(a.lat - HOUSE_1.lat)).toBeLessThanOrEqual(g / 2);
    expect(Math.abs(a.lng - HOUSE_1.lng)).toBeLessThanOrEqual(g / 2);
    expect(() => coarsePricingPoint({ ...HOUSE_1, suburb: null, city: null, postalCode: null }, 0)).toThrow(RangeError);
  });

  it('two owners at different houses in the same cell get identical fees from the same renter address (both legs)', async () => {
    // Exact distance would tell them apart: that is what the renter could trilaterate.
    const home = w.addresses.points.get(RENTER_HOME)!;
    expect(exactFee(HOUSE_1, home)).not.toBe(exactFee(HOUSE_2, home));
    Object.assign(w.addresses.points.get(PICK_A)!, HOUSE_1);
    Object.assign(w.addresses.points.get(PICK_B)!, HOUSE_2);
    for (const leg of ['outbound', 'return'] as const) {
      const a = await quoteOne(w, { leg, owner: OWNER_A, ownerAddress: PICK_A, rentalIndex: 1 });
      const b = await quoteOne(w, { leg, owner: OWNER_B, ownerAddress: PICK_B, rentalIndex: 2 });
      expect(a).toBe(b);
      const cell = coarsePricingPoint({ ...HOUSE_1, suburb: null, city: null, postalCode: null });
      expect(a).toBe(leg === 'outbound' ? exactFee(cell, home) : exactFee(home, cell));
    }
  });

  it('the provider is asked with the cell centre and area only: no street, contact or exact point for the owner side', async () => {
    const seen = spyOnQuotes(w);
    await quoteOne(w, { leg: 'outbound', owner: OWNER_B, ownerAddress: PICK_B, rentalIndex: 2 });
    await quoteOne(w, { leg: 'return', owner: OWNER_B, ownerAddress: PICK_B, rentalIndex: 2 });
    const b = w.addresses.points.get(PICK_B)!;
    const [out, back] = seen;
    for (const ownerSide of [out.from, back.to]) {
      expect(ownerSide).toEqual(coarsePricingPoint(b));
      expect(JSON.stringify(ownerSide)).not.toMatch(/Owner Road|Bongani|0820000004/);
    }
    // The renter's own end is untouched.
    expect(out.to).toEqual(w.addresses.points.get(RENTER_HOME));
  });

  it('a studio leg is priced exactly as before: the provider sees the verified points unchanged', async () => {
    const seen = spyOnQuotes(w);
    const fee = await quoteOne(w, { leg: 'outbound', owner: null, ownerAddress: OFFICE, rentalIndex: 0 });
    expect(fee).toBe(exactFee(w.addresses.points.get(OFFICE)!, w.addresses.points.get(RENTER_HOME)!));
    expect(seen[0].from).toEqual(w.addresses.points.get(OFFICE));
    expect(seen[0].to).toEqual(w.addresses.points.get(RENTER_HOME));
  });
});

// ── Shared set-up for the custody findings ──────────────────────────────────

async function paidAndDispatched(w: OriginWorld): Promise<void> {
  const r = await quoteCartDelivery(
    { caller: renter, renterId: RENTER, renterAddressId: RENTER_HOME, siteAddressId: OFFICE, lines: MIXED_LINES, legs: [{ leg: 'outbound', window: OUT_WINDOW }, { leg: 'return', window: BACK_WINDOW }], bookingGroupId: GROUP },
    w.deps,
  );
  if (!r.ok) throw new Error(r.code);
  const total = r.quotes.reduce((n, q) => n + q.customerFeeCents, 0);
  expect((await dispatchDeliveryAfterPayment({ bookingGroupId: GROUP, paidDeliveryCents: total }, { delivery: w.deps, links: w.links })).outcome).toBe('done');
}

const legOf = (w: OriginWorld, leg: 'outbound' | 'return', origin: string | null): Shipment => {
  const s = [...w.repo.shipments.values()].find((x) => x.leg === leg && (x.originOwnerId ?? null) === origin);
  if (!s) throw new Error(`no ${leg} leg for ${origin ?? 'studio'}`);
  return s;
};

async function deliverOwnerAOutbound(w: OriginWorld): Promise<void> {
  const s = legOf(w, 'outbound', OWNER_A);
  await confirmCollection({ caller: ownerA, shipmentId: s.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: PHOTO }, w.deps);
  await confirmCollection({ caller: staff, shipmentId: s.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: PHOTO }, w.deps);
  await confirmHandover({ caller: staff, shipmentId: s.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: PHOTO, outcome: 'delivered' }, w.deps);
  expect(await confirmHandover({ caller: renter, shipmentId: s.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: [], outcome: 'accepted' }, w.deps)).toMatchObject({ ok: true });
}

const returnKey = `delivery:${GROUP}:return@${OWNER_A}`;

// ── P2: the owner cannot mark a return received while the renter has the gear ──

describe('P2: an owner confirms a return only once the gear has left the renter', () => {
  let w: OriginWorld;
  beforeEach(async () => {
    w = originWorld();
    await paidAndDispatched(w);
    await deliverOwnerAOutbound(w);
  });

  it('a scheduled return (gear still with the renter): received, damaged and a direct handover are all refused; nothing moves', async () => {
    const r = legOf(w, 'return', OWNER_A);
    expect(r.status).toBe('scheduled');
    const base = { caller: ownerA, shipmentId: r.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: PHOTO };
    expect(await confirmOwnerReturn({ ...base, outcome: 'received', condition: 'Good' }, w.deps)).toMatchObject({ ok: false, code: 'not_returned_yet' });
    expect(await confirmOwnerReturn({ ...base, outcome: 'problem', problem: { kind: 'damaged', description: 'Scratched' } }, w.deps)).toMatchObject({ ok: false, code: 'not_returned_yet' });
    expect(await confirmHandover({ ...base, outcome: 'received' }, w.deps)).toMatchObject({ ok: false, code: 'not_returned_yet' });
    expect(w.repo.custody.filter((c) => c.shipmentId === r.id)).toEqual([]);
    expect(w.repo.shipments.get(r.id)?.status).toBe('scheduled');
    expect(w.repo.journals.has(returnKey)).toBe(false);
    expect((await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-a' }, w.deps)).allowed).toBe(false);
    // The owner's screen offers nothing either (same predicate).
    const view = ownerLegs(OWNER_A, [...w.repo.shipments.values()], w.repo.custody).find((l) => l.leg === 'return');
    expect(view?.items[0].can_confirm_return).toBe(false);
  });

  it('once our driver collected it from the renter, the owner can confirm (screen and server agree)', async () => {
    const r = legOf(w, 'return', OWNER_A);
    await confirmCollection({ caller: staff, shipmentId: r.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: PHOTO }, w.deps);
    const view = ownerLegs(OWNER_A, [...w.repo.shipments.values()], w.repo.custody).find((l) => l.leg === 'return');
    expect(view?.items[0].can_confirm_return).toBe(true);
    expect(await confirmOwnerReturn({ caller: ownerA, shipmentId: r.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: PHOTO, outcome: 'received', condition: 'Good' }, w.deps)).toMatchObject({ ok: true, duplicate: false });
    expect(w.repo.journals.has(returnKey)).toBe(true);
  });

  it('a leg at the owner\'s door (courier_at_dropoff) is enough without a per-item record', async () => {
    const r = legOf(w, 'return', OWNER_A);
    await advanceManualDelivery({ caller: staff, shipmentId: r.id, state: 'courier_at_dropoff' }, w.deps);
    expect(await confirmOwnerReturn({ caller: ownerA, shipmentId: r.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: PHOTO, outcome: 'received', condition: 'Good' }, w.deps)).toMatchObject({ ok: true });
  });

  it('the predicate itself', () => {
    const ev = (kind: CustodyEvent['kind']) => ({ kind });
    expect(ownerMayConfirmReturn('scheduled', [])).toBe(false);
    expect(ownerMayConfirmReturn('collected', [])).toBe(false);
    expect(ownerMayConfirmReturn('in_transit', [])).toBe(false);
    expect(ownerMayConfirmReturn('scheduled', [ev('handed_to_return_courier')])).toBe(true);
    expect(ownerMayConfirmReturn('collected', [ev('collected_by_courier')])).toBe(true);
    for (const s of ['courier_at_dropoff', 'delivered', 'incident_under_review'] as const) expect(ownerMayConfirmReturn(s, [])).toBe(true);
  });
});

// ── P3.1: a missing item is an incident, never a receipt ────────────────────

describe('P3.1: the owner reports an item missing: incident only, nothing received, inspected or earned', () => {
  let w: OriginWorld;
  beforeEach(async () => {
    w = originWorld();
    await paidAndDispatched(w);
    await deliverOwnerAOutbound(w);
  });

  it('records the incident on the owner\'s line and puts the leg under review; a replay adds nothing', async () => {
    const r = legOf(w, 'return', OWNER_A);
    await confirmCollection({ caller: staff, shipmentId: r.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: PHOTO }, w.deps);
    await advanceManualDelivery({ caller: staff, shipmentId: r.id, state: 'courier_at_dropoff' }, w.deps);
    const input = { caller: ownerA, shipmentId: r.id, bookingId: 'bk-a', rentalId: LENS_A, evidence: PHOTO, outcome: 'problem' as const, problem: { kind: 'lost' as const, description: 'The lens never arrived' } };
    expect(await confirmOwnerReturn(input, w.deps)).toMatchObject({ ok: true, duplicate: false });
    expect(w.repo.custody.filter((c) => c.shipmentId === r.id).map((c) => c.kind)).toEqual(['collected_by_courier']);
    expect(w.repo.shipments.get(r.id)?.status).toBe('incident_under_review');
    expect(w.repo.shipments.get(r.id)?.acceptedAt ?? null).toBeNull();
    expect(w.repo.journals.has(returnKey)).toBe(false);
    const incidents = [...w.repo.incidents.values()];
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ kind: 'lost', bookingIds: ['bk-a'], liability: 'undetermined', reportedBy: { kind: 'owner', id: OWNER_A } });
    const held = await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-a' }, w.deps);
    expect(held.allowed).toBe(false);
    expect(held.reasons).toEqual(expect.arrayContaining(['awaiting_inspection', 'open_delivery_incident']));
    expect(await confirmOwnerReturn(input, w.deps)).toMatchObject({ ok: true, duplicate: true });
    expect(w.repo.incidents.size).toBe(1);
  });
});

// ── P3.2: one staff alert per unused quote refunded ──────────────────────────

describe('P3.2: two owner-origin quotes with the same fee each raise their own refund alert', () => {
  it('both alerts reach staff', async () => {
    const w = originWorld();
    const r = await quoteCartDelivery({ caller: renter, renterId: RENTER, renterAddressId: RENTER_HOME, siteAddressId: OFFICE, lines: MIXED_LINES, legs: [{ leg: 'outbound', window: OUT_WINDOW }], bookingGroupId: GROUP }, w.deps);
    if (!r.ok) throw new Error(r.code);
    const owners = r.quotes.filter((q) => q.originOwnerId);
    expect(owners).toHaveLength(2);
    for (const q of owners) Object.assign(w.repo.quotes.get(q.id)!, { status: 'paid', paidReference: 'pay-ref-1', bookingGroupId: GROUP, customerFeeCents: 25_000, providerCostCents: 25_000, quoteAmountCents: 25_000 });
    for (const q of owners) expect(await refundUnusedDeliveryQuote({ caller: staff, quoteId: q.id, reason: 'not run' }, w.deps)).toMatchObject({ ok: true, outcome: 'refunded', refundCents: 25_000 });
    const alerts = [...w.repo.outbox.values()].filter((n) => n.userId === 'staff' && (n.data as { what?: string }).what === 'delivery_unused_quote_refunded');
    expect(alerts).toHaveLength(2);
  });
});

// ── P3.3: the cancellation keeps each owner's return while their gear is out ──

describe('P3.3: "the renter may still have the gear" is decided per origin', () => {
  const ship = (id: string, leg: 'outbound' | 'return', status: Shipment['status'], originOwnerId: string | null): Shipment =>
    ({ id, leg, status, originOwnerId, quoteId: `q-${id}`, paidReference: 'pay-ref-1', customerFeeCents: 10_000, providerKind: 'own_fleet', providerReference: null }) as unknown as Shipment;
  const fakeDb = {
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'limit']) b[m] = () => b;
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: table === 'equipment_bookings' ? [{ id: 'bk-s', status: 'cancelled' }] : table === 'delivery_shipments' ? [{ id: 'x' }] : [], error: null }).then(resolve);
      return b;
    },
  };

  it('the studio gear is back, owner A\'s is still out: owner A\'s scheduled return is kept, not cancelled or refunded', async () => {
    const legs = [ship('s-out', 'outbound', 'delivered', null), ship('s-ret', 'return', 'delivered', null), ship('a-out', 'outbound', 'delivered', OWNER_A), ship('a-ret', 'return', 'scheduled', OWNER_A), ship('b-ret', 'return', 'scheduled', OWNER_B)];
    const plan = await deliveryCancellationPlan(fakeDb as never, { bookingGroupId: GROUP, bookingId: 'bk-s' }, { listShipments: async () => legs });
    expect(plan.gearWithRenter).toBe(true);
    expect(plan.returnKeptShipmentIds).toEqual(['a-ret']);
    expect(plan.shipmentIds).not.toContain('a-ret');
    // Owner B's gear never went out: their return is cancelled with the order as before.
    expect(plan.shipmentIds).toContain('b-ret');
  });

  it('per origin, and a studio-only order exactly as before', () => {
    expect([...originsWithGearAtRenter([ship('1', 'outbound', 'delivered', null), ship('2', 'return', 'delivered', OWNER_A)])]).toEqual(['']);
    expect([...originsWithGearAtRenter([ship('1', 'outbound', 'delivered', null), ship('2', 'return', 'delivered', null)])]).toEqual([]);
    expect([...originsWithGearAtRenter([ship('1', 'outbound', 'damaged', OWNER_A), ship('2', 'return', 'incident_under_review', OWNER_B)])]).toEqual([OWNER_A]);
  });
});

// ── P3.4, P3.5: the owner's pickup address store ─────────────────────────────

type Row = Record<string, unknown>;
/** A small PostgREST stand-in for delivery_shipments / delivery_addresses, recording what the client asked. */
function fakeDb(shipments: Row[], opts: { rpcError?: string } = {}) {
  const ops: string[] = [];
  return {
    ops,
    rpc: async (name: string, args: Row) => {
      ops.push(`rpc:${name}`);
      return opts.rpcError ? { data: null, error: { message: opts.rpcError } } : { data: 'new-address', error: null, args };
    },
    from(table: string) {
      let rows = table === 'delivery_shipments' ? [...shipments] : [{ id: 'new-address', formatted_address: '1 New Road', suburb: 'Melville', city: 'Johannesburg', postal_code: '2092', contact_name: 'A', contact_phone: '0', instructions: null, verified_at: '2026-10-10T08:00:00Z' }];
      const b: Record<string, unknown> = {};
      const chain = (fn: (r: Row[]) => Row[]) => {
        rows = fn(rows);
        return b;
      };
      b.select = () => b;
      b.eq = (c: string, v: unknown) => chain((r) => r.filter((x) => x[c] === v));
      b.contains = () => b;
      b.not = (c: string, op: string, v: string) => {
        ops.push(`not:${c}`);
        const vs = v.replace(/[()]/g, '').split(',');
        return chain((r) => r.filter((x) => !(op === 'in' && vs.includes(String(x[c])))));
      };
      b.or = (expr: string) => {
        ops.push(`or:${expr}`);
        const tests = expr.split(',').map((t) => {
          const [c, op, v] = t.split('.');
          return (x: Row) => (op === 'neq' ? x[c] !== v : op === 'is' && v === 'null' ? x[c] === null || x[c] === undefined : false);
        });
        return chain((r) => r.filter((x) => tests.some((t) => t(x))));
      };
      b.limit = (n: number) => chain((r) => r.slice(0, n));
      b.update = () => {
        ops.push(`update:${table}`);
        return b;
      };
      b.insert = () => {
        ops.push(`insert:${table}`);
        return b;
      };
      b.is = () => b;
      b.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
      return b;
    },
  };
}

describe('P3.4: a long history never hides an owner\'s live leg', () => {
  it('300 finished legs (cancelled, failed, delivered and accepted) and one live one: found', async () => {
    const done: Row[] = [];
    for (let i = 0; i < 100; i++) {
      done.push({ id: `c${i}`, origin_owner_id: OWNER_A, status: 'cancelled', accepted_at: null });
      done.push({ id: `f${i}`, origin_owner_id: OWNER_A, status: 'failed', accepted_at: null });
      done.push({ id: `d${i}`, origin_owner_id: OWNER_A, status: 'delivered', accepted_at: '2026-01-01T00:00:00Z' });
    }
    const db = fakeDb([...done, { id: 'live', origin_owner_id: OWNER_A, status: 'scheduled', accepted_at: null }]);
    expect(await new SupabaseOwnerPickup(db as never).hasLiveLeg(OWNER_A)).toBe(true);
    expect(db.ops).toEqual(expect.arrayContaining(['not:status', 'or:status.neq.delivered,accepted_at.is.null']));
    expect(await new SupabaseOwnerPickup(fakeDb(done) as never).hasLiveLeg(OWNER_A)).toBe(false);
    // A delivered leg the renter has not accepted yet is still live.
    expect(await new SupabaseOwnerPickup(fakeDb([...done, { id: 'd', origin_owner_id: OWNER_A, status: 'delivered', accepted_at: null }]) as never).hasLiveLeg(OWNER_A)).toBe(true);
  });
});

describe('P3.5: replacing the pickup address is one database transaction', () => {
  const address = { formattedAddress: '1 New Road, Melville', suburb: 'Melville', city: 'Johannesburg', province: 'Gauteng', postalCode: '2092', lat: -26.17, lng: 28.0 } as never;
  const input = { ownerId: OWNER_A, address, verifiedBy: 'test', contactName: 'Ayanda', contactPhone: '0820000003', instructions: null };

  it('saves through delivery_save_owner_pickup only: the client never retires the old row itself', async () => {
    const db = fakeDb([]);
    const r = await new SupabaseOwnerPickup(db as never).save(input);
    expect(r).toMatchObject({ ok: true, address: { id: 'new-address' } });
    expect(db.ops).toContain('rpc:delivery_save_owner_pickup');
    expect(db.ops.some((o) => o.startsWith('update:') || o.startsWith('insert:'))).toBe(false);
  });

  it('a failed save throws and has changed nothing from the client (the database rolled the retirement back)', async () => {
    const db = fakeDb([], { rpcError: 'new row violates check constraint' });
    await expect(new SupabaseOwnerPickup(db as never).save(input)).rejects.toThrow(/owner pickup save failed/);
    expect(db.ops.some((o) => o.startsWith('update:') || o.startsWith('insert:'))).toBe(false);
  });
});

// ── P3.6: no courier tracking page for a leg from or back to an owner ────────

describe('P3.6: the renter never gets the tracking link of an owner-origin leg', () => {
  it('hidden for the renter (status and screen), kept for studio legs and for staff', async () => {
    const w = originWorld();
    await paidAndDispatched(w);
    for (const s of w.repo.shipments.values()) s.trackingUrl = 'https://track.example/leg';
    const r = await getDeliveryStatus({ caller: renter, bookingGroupId: GROUP }, w.deps);
    if (!r.ok) throw new Error(r.code);
    for (const l of r.legs) expect(l.trackingUrl).toBe(l.originOwnerId ? null : 'https://track.example/leg');
    const screen = customerLegs(r.legs, [...w.repo.shipments.values()]);
    expect(screen.filter((l) => l.from === 'owner').every((l) => l.tracking_url === null)).toBe(true);
    expect(screen.filter((l) => l.from === 'studio').every((l) => l.tracking_url === 'https://track.example/leg')).toBe(true);
    // The screen does not trust its input either.
    const leaked = customerLegs(r.legs.map((l) => ({ ...l, trackingUrl: 'https://track.example/leg' })), [...w.repo.shipments.values()]);
    expect(leaked.filter((l) => l.from === 'owner').every((l) => l.tracking_url === null)).toBe(true);
    const asStaff = await getDeliveryStatus({ caller: staff, bookingGroupId: GROUP }, w.deps);
    if (!asStaff.ok) throw new Error(asStaff.code);
    expect(asStaff.legs.every((l) => l.trackingUrl === 'https://track.example/leg')).toBe(true);
  });
});
