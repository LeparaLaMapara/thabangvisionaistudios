/**
 * Admin delivery operations at API level (spec Phase 4 §4.18):
 *  - only admins: a non-admin (e.g. an owner) gets 403 from every endpoint
 *    and nothing runs (D22 at API level: no shipment lists for non-staff);
 *  - addresses are not in the queues or the detail by default (D21); a
 *    reveal returns one side of one shipment and is logged with ids only;
 *  - every action goes through the delivery use cases as staff and is
 *    logged with ids and outcomes only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { DeliveryDeps } from '@/lib/core/delivery/repository';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  admin: true,
  deps: null as unknown,
  logs: [] as { eventType: string; eventCategory: string; userId?: string | null; metadata?: Record<string, unknown> }[],
  tables: {} as Record<string, Record<string, unknown>[]>,
  selects: [] as { table: string; cols: string }[],
  updates: [] as { table: string; values: Record<string, unknown> }[],
  ranUseCase: 0,
}));

/** A small PostgREST stand-in: projects selected columns, applies eq/in filters, records selects and updates. */
function fakeDb() {
  const from = (table: string) => {
    let cols = '*';
    let head = false;
    let update: Row | null = null;
    const filters: ((r: Row) => boolean)[] = [];
    const project = (r: Row): Row => {
      if (cols === '*') return { ...r };
      const out: Row = {};
      for (const c of cols.split(',').map((x) => x.trim())) if (c && !c.includes('(')) out[c] = r[c] ?? null;
      return out;
    };
    const rows = () => (state.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const run = () => {
      if (update) {
        state.updates.push({ table, values: update });
        const hit = rows();
        hit.forEach((r) => Object.assign(r, update));
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      if (head) return { data: null, error: null, count: rows().length };
      return { data: rows().map(project), error: null };
    };
    const b: Record<string, unknown> = {
      select: (c?: string, opts?: { head?: boolean }) => {
        if (!update) {
          cols = c ?? '*';
          head = !!opts?.head;
          state.selects.push({ table, cols });
        }
        return b;
      },
      update: (v: Row) => {
        update = v;
        return b;
      },
      eq: (k: string, v: unknown) => {
        filters.push((r) => r[k] === v);
        return b;
      },
      in: (k: string, v: unknown[]) => {
        filters.push((r) => v.includes(r[k]));
        return b;
      },
      not: () => b,
      is: () => b,
      gte: () => b,
      gt: () => b,
      lt: () => b,
      lte: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: async () => {
        const r = run();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : null, error: r.error };
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return { from };
}

vi.mock('@/lib/auth', () => ({
  requireAdmin: async () =>
    state.admin
      ? { user: { id: '00000000-0000-4000-8000-0000000000c1', email: 'staff@example.invalid' }, error: null }
      : { user: null, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) },
  rateLimitAdmin: async () => null,
}));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => fakeDb(), createClient: async () => fakeDb() }));
vi.mock('@/lib/delivery/server', () => ({
  deliveryDeps: async () => {
    state.ranUseCase += 1;
    return state.deps;
  },
}));
vi.mock('@/lib/data/events', () => ({ logEvent: (e: (typeof state.logs)[number]) => state.logs.push(e) }));
vi.mock('@/lib/rental/notify', () => ({ dispatchOutbox: async () => ({}) }));

const { GET, POST } = await import('@/app/api/admin/delivery/route');
const { GET: DETAIL } = await import('@/app/api/admin/delivery/[id]/route');
const { commitDelivery, prepareDelivery, quoteDelivery, reportIncident } = await import('@/lib/core/delivery/use-cases');
const { GROUP, LINES_FOR_QUOTE, OFFICE, RENTER, RENTER_HOME, STAFF, world } = await import('./helpers/delivery-fakes');

const post = (body: Row) => POST(new NextRequest('http://localhost:3000/api/admin/delivery', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
const CLOUD_PHOTO = 'https://res.cloudinary.com/demo/image/upload/v1/delivery/a.jpg';
// Evidence must be in OUR cloud; with no cloud configured it is refused (fail closed, review item 19).
vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'demo');

/** An own-fleet outbound leg, dispatched (scheduled). */
async function ownFleetLeg() {
  const w = world({ providers: 'manual' });
  const q = await quoteDelivery({ caller: { kind: 'renter', userId: RENTER }, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: { start: '2026-10-20T07:00:00Z', end: '2026-10-20T09:00:00Z' } }, w.deps);
  if (!q.ok) throw new Error('quote');
  w.repo.quotes.get(q.quotes[0].id)!.customerFeeCents = 0;
  const p = await prepareDelivery({ caller: { kind: 'renter', userId: RENTER }, quoteId: q.quotes[0].id, bookingGroupId: GROUP }, w.deps);
  if (!p.ok) throw new Error(p.code);
  const c = await commitDelivery({ caller: { kind: 'system' }, shipmentId: p.shipment.id }, w.deps);
  if (!c.ok) throw new Error(c.code);
  state.deps = w.deps as DeliveryDeps;
  return { w, shipment: p.shipment };
}

const SHIP_ID = '11111111-1111-4111-8111-111111111111';
const ADDR_O = '22222222-2222-4222-8222-222222222222';
const ADDR_D = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  state.admin = true;
  state.logs = [];
  state.selects = [];
  state.updates = [];
  state.ranUseCase = 0;
  state.tables = {
    delivery_shipments: [
      {
        id: SHIP_ID,
        booking_group_id: GROUP,
        leg: 'outbound',
        attempt: 1,
        renter_id: RENTER,
        items: [{ bookingId: 'bk-1', rentalId: 'cam-1', ownerId: 'owner-a', serialNumber: 'SN1' }],
        provider: 'manual',
        provider_kind: 'own_fleet',
        status: 'scheduled',
        merchant_reference: 'tvd_x_o1',
        provider_reference: 'man_1',
        origin_address_id: ADDR_O,
        destination_address_id: ADDR_D,
        tracking_url: 'https://track.example/where-the-renter-lives',
        window_start: '2026-10-20T07:00:00Z',
        window_end: '2026-10-20T09:00:00Z',
        quote_amount_cents: 15000,
        customer_fee_cents: 15000,
        accrued_cost_cents: 0,
        provider_cost_cents: null,
        coverage_verified: false,
        created_at: '2026-10-10T08:00:00Z',
        updated_at: '2026-10-10T08:00:00Z',
      },
    ],
    delivery_addresses: [
      { id: ADDR_O, formatted_address: '99 Smith Street, Braamfontein', contact_name: 'Desk', contact_phone: '0110000000', suburb: 'Braamfontein', city: 'Johannesburg' },
      { id: ADDR_D, formatted_address: '1 Test Road, Sandton', contact_name: 'Thandi', contact_phone: '0820000001', instructions: 'Gate 2', suburb: 'Sandton', city: 'Johannesburg' },
    ],
  };
});

describe('admin authorisation', () => {
  it('a non-admin (an owner, a renter) gets 403 everywhere and nothing runs', async () => {
    state.admin = false;
    expect((await GET()).status).toBe(403);
    expect((await DETAIL(new NextRequest(`http://localhost:3000/api/admin/delivery/${SHIP_ID}`), { params: Promise.resolve({ id: SHIP_ID }) })).status).toBe(403);
    for (const action of ['advance_manual', 'cancel', 'reveal_address', 'dispatch', 'resolve_incident', 'run_jobs']) {
      expect((await post({ action, shipmentId: SHIP_ID, side: 'destination' })).status).toBe(403);
    }
    expect(state.ranUseCase).toBe(0);
    expect(state.selects).toHaveLength(0);
    expect(state.logs).toHaveLength(0);
  });
});

describe('D21 - addresses are hidden from staff lists by default', () => {
  it('the queues never select or return an address, address id, contact or tracking link', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { pipeline: boolean; queues: Record<string, Row[]> };
    expect(json.pipeline).toBe(true);
    expect(json.queues.scheduled.map((s) => s.id)).toEqual([SHIP_ID]);
    const text = JSON.stringify(json);
    for (const secret of [ADDR_O, ADDR_D, 'Smith Street', 'Test Road', '0820000001', 'where-the-renter-lives']) expect(text).not.toContain(secret);
    for (const s of state.selects) expect(s.cols).not.toMatch(/address|contact|tracking_url|instructions/);
  });

  it('the shipment detail does not include them either', async () => {
    const res = await DETAIL(new NextRequest(`http://localhost:3000/api/admin/delivery/${SHIP_ID}`), { params: Promise.resolve({ id: SHIP_ID }) });
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    for (const secret of [ADDR_O, ADDR_D, 'Test Road', 'where-the-renter-lives']) expect(text).not.toContain(secret);
  });

  it('reveal returns one side for dispatch and is logged with ids only', async () => {
    const res = await post({ action: 'reveal_address', shipmentId: SHIP_ID, side: 'destination' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const json = (await res.json()) as { address: Row; trackingUrl: string };
    expect(json.address.formatted_address).toBe('1 Test Road, Sandton');
    expect(JSON.stringify(json)).not.toContain('Smith Street'); // only the side asked for
    expect(state.logs).toEqual([
      { eventType: 'delivery_ops_reveal_address', eventCategory: 'admin', userId: STAFF, metadata: { shipmentId: SHIP_ID, side: 'destination', addressId: ADDR_D, outcome: 'revealed' } },
    ]);
  });
});

const ALLOWED_META = /^(shipmentId|state|outcome|bookingId|rentalId|photos|kind|incidentId|liability|providerCaused|initiatedBy|refundCents|providerFeeCents|differenceCents|duplicate|side|addressId|eventId|claimed|bookingGroupId|leg|quotes|inboxClaimed|reconciled|polled)$/;

describe('actions go through the use cases as staff and are logged', () => {
  it('advance an own-fleet leg: applied as a staff event, logged with ids only', async () => {
    const { w, shipment } = await ownFleetLeg();
    const res = await post({ action: 'advance_manual', shipmentId: shipment.id, state: 'courier_assigned' });
    expect(res.status).toBe(200);
    expect(w.repo.shipments.get(shipment.id)!.status).toBe('courier_assigned');
    expect(w.repo.events.at(-1)).toMatchObject({ to: 'courier_assigned', source: 'staff' });
    expect(state.logs.at(-1)).toMatchObject({ eventType: 'delivery_ops_advance_manual', userId: STAFF, metadata: { shipmentId: shipment.id, state: 'courier_assigned', outcome: 'applied' } });
  });

  it('collection evidence must be our storage; the custody event names staff and the item', async () => {
    const { w, shipment } = await ownFleetLeg();
    const bad = await post({ action: 'record_collection', shipmentId: shipment.id, bookingId: '00000000-0000-4000-8000-0000000000e1', rentalId: '00000000-0000-4000-8000-0000000000e2', photos: ['https://evil.example/x.jpg'] });
    expect(bad.status).toBe(400);
    // The fakes' booking and listing ids are not uuids (the route requires uuids): give the items uuid ids.
    w.repo.shipments.get(shipment.id)!.items = shipment.items.map((i, n) => ({ ...i, bookingId: `00000000-0000-4000-8000-00000000f0${n}1`, rentalId: `00000000-0000-4000-8000-00000000f0${n}2` }));
    const ids = w.repo.shipments.get(shipment.id)!.items[0];
    const ok = await post({ action: 'record_collection', shipmentId: shipment.id, bookingId: ids.bookingId, rentalId: ids.rentalId, photos: [CLOUD_PHOTO], serialConfirmed: true, condition: 'good', accessories: [{ name: 'Battery', present: true }] });
    expect(ok.status).toBe(200);
    expect(w.repo.custody.at(-1)).toMatchObject({ kind: 'collected_by_courier', actor: { kind: 'thabangvision_staff', id: STAFF }, bookingId: ids.bookingId, evidence: [{ kind: 'photo', ref: CLOUD_PHOTO }] });
    const meta = state.logs.at(-1)!.metadata!;
    expect(meta).toMatchObject({ shipmentId: shipment.id, photos: 1, outcome: 'recorded' });
    expect(JSON.stringify(meta)).not.toContain('cloudinary');
  });

  it('staff can never accept a delivery for the renter (D15)', async () => {
    const { shipment } = await ownFleetLeg();
    const res = await post({ action: 'record_handover', shipmentId: shipment.id, bookingId: '00000000-0000-4000-8000-0000000000e1', rentalId: '00000000-0000-4000-8000-0000000000e2', outcome: 'accepted', photos: [CLOUD_PHOTO] });
    expect(res.status).toBe(400);
  });

  it('resolve an incident: liability is what the person chose; free text is not logged', async () => {
    const { w, shipment } = await ownFleetLeg();
    const r = await reportIncident({ caller: { kind: 'renter', userId: RENTER }, shipmentId: shipment.id, kind: 'delayed', description: 'Driver was two hours late' }, w.deps);
    if (!r.ok) throw new Error(r.code);
    expect((await post({ action: 'resolve_incident', incidentId: r.incidentId, resolution: 'x', liability: 'renter' })).status).toBe(400);
    expect((await post({ action: 'resolve_incident', incidentId: r.incidentId, resolution: 'Traffic on the N1', liability: 'blame-everyone' })).status).toBe(400);
    const ok = await post({ action: 'resolve_incident', incidentId: r.incidentId, resolution: 'Traffic on the N1, nobody at fault', liability: 'none', providerCaused: true });
    expect(ok.status).toBe(200);
    expect(w.repo.incidents.get(r.incidentId)).toMatchObject({ status: 'resolved', liability: 'none', providerCaused: true });
    expect(JSON.stringify(state.logs)).not.toContain('Traffic');
  });

  it('cancel an unstarted leg; a courier leg cannot be rescheduled', async () => {
    const { w, shipment } = await ownFleetLeg();
    const res = await post({ action: 'cancel', shipmentId: shipment.id, reason: 'Renter will collect instead' });
    expect(res.status).toBe(200);
    expect(w.repo.shipments.get(shipment.id)!.status).toBe('cancelled');
    w.repo.shipments.get(shipment.id)!.providerKind = 'courier';
    w.repo.shipments.get(shipment.id)!.status = 'scheduled';
    const r2 = await post({ action: 'reschedule', shipmentId: shipment.id, date: '2026-10-21' });
    expect(r2.status).toBe(409);
    expect(((await r2.json()) as Row).code).toBe('not_supported');
  });

  it('reschedule an own-fleet leg: one staff event, window saved', async () => {
    const { w, shipment } = await ownFleetLeg();
    const res = await post({ action: 'reschedule', shipmentId: shipment.id, date: '2026-10-21' });
    expect(res.status).toBe(200);
    expect(w.repo.events.at(-1)).toMatchObject({ source: 'staff', to: w.repo.shipments.get(shipment.id)!.status });
    expect(state.updates.map((u) => u.table).sort()).toEqual(['delivery_manual_tasks', 'delivery_shipments']);
    expect(state.updates[0].values.window_start).toBe('2026-10-20T22:00:00.000Z');
    // Same request again: logged once (dedupe), the window write is idempotent.
    await post({ action: 'reschedule', shipmentId: shipment.id, date: '2026-10-21' });
    expect(w.repo.events.filter((e) => e.dedupeKey?.startsWith('reschedule:'))).toHaveLength(1);
  });

  it('quote a return leg for the renter: stored server quote, renter told a quote is ready (amount only)', async () => {
    const { w } = await ownFleetLeg();
    const res = await post({ action: 'quote_leg', bookingGroupId: GROUP, leg: 'return', date: '2026-10-22' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { quotes: { id: string; customerFeeCents: number }[] };
    const stored = w.repo.quotes.get(json.quotes[0].id)!;
    expect(stored).toMatchObject({ leg: 'return', originAddressId: RENTER_HOME, destinationAddressId: OFFICE, renterId: RENTER });
    const ready = [...w.repo.outbox.values()].filter((n) => n.kind === 'delivery_quote_ready');
    expect(ready.length).toBeGreaterThan(0);
    expect(ready.every((n) => n.userId === RENTER && JSON.stringify(n.data) === JSON.stringify({ amountCents: stored.customerFeeCents }))).toBe(true);
  });

  it('every action log carries ids, codes and numbers only', async () => {
    const { shipment } = await ownFleetLeg();
    await post({ action: 'advance_manual', shipmentId: shipment.id, state: 'courier_assigned' });
    await post({ action: 'report_incident', shipmentId: shipment.id, kind: 'delayed', description: 'Renter phoned, 1 Test Road gate locked' });
    await post({ action: 'reveal_address', shipmentId: SHIP_ID, side: 'origin' });
    expect(state.logs.length).toBeGreaterThanOrEqual(3);
    for (const l of state.logs) {
      expect(l.eventCategory).toBe('admin');
      expect(l.userId).toBe(STAFF);
      for (const [k, v] of Object.entries(l.metadata ?? {})) {
        expect(k).toMatch(ALLOWED_META);
        expect(['string', 'number', 'boolean'].includes(typeof v) || v === null).toBe(true);
      }
    }
    expect(JSON.stringify(state.logs)).not.toContain('Test Road');
  });

  it('unknown actions and malformed ids are refused before anything runs', async () => {
    expect((await post({ action: 'drop_tables' })).status).toBe(400);
    expect((await post({ action: 'cancel', shipmentId: "1' or 1=1", reason: 'abc' })).status).toBe(400);
    expect(state.ranUseCase).toBe(0);
  });
});
