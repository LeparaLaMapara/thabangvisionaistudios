/**
 * Daily delivery jobs (lib/delivery/jobs.ts), run by the rental pipeline:
 * bounded, isolated and idempotent. Reconciliation of an unknown dispatch
 * never books a second courier (D10); polling applies a missed provider
 * update once and never backwards (D12, D13); return reminders are sent once;
 * the address purge never touches an address an open shipment uses (R-41).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_DELIVERY_POLICY } from '@/lib/core/delivery/policy';
import { commitDelivery, prepareDelivery, quoteDelivery } from '@/lib/core/delivery/use-cases';
import { deliveryEventDedupeKey } from '@/lib/delivery/inbox';
import {
  addressPurgeDecision,
  pollTrackedShipments,
  purgeDeliveryAddresses,
  reconcileUncertainDispatches,
  redactedAddressFields,
  remindReturnPickups,
  type AddressReference,
  type AddressRetentionStore,
  type DeliveryJobQueries,
  type RetentionAddress,
} from '@/lib/delivery/jobs';
import { recordProviderEvent } from '@/lib/core/delivery/use-cases';
import { GROUP, LINES_FOR_QUOTE, OFFICE, RENTER, RENTER_HOME, world, type World } from './helpers/delivery-fakes';

const renter = { kind: 'renter' as const, userId: RENTER };

/** Queries over the in-memory repo, mirroring the Supabase adapter's filters. */
function queries(w: World): DeliveryJobQueries {
  return {
    async listUncertainDispatches(staleBefore, limit) {
      return [...w.repo.intents.values()]
        .filter((i) => i.state === 'unknown' || (i.state === 'claimed' && (!i.claimedAt || i.claimedAt < staleBefore)))
        .slice(0, limit)
        .map((i) => ({ shipmentId: i.shipmentId }));
    },
    async listTrackableShipments(limit) {
      return [...w.repo.shipments.values()]
        .filter((s) => s.providerKind === 'courier' && s.providerReference && ['scheduled', 'courier_assigned', 'courier_at_pickup', 'collected', 'in_transit', 'courier_at_dropoff', 'delivery_attempt_failed'].includes(s.status))
        .slice(0, limit);
    },
    async listUpcomingReturnPickups(from, to, limit) {
      return [...w.repo.shipments.values()]
        .filter((s) => s.leg === 'return' && ['scheduled', 'courier_assigned'].includes(s.status) && !!s.window.start && s.window.start >= from && s.window.start <= to)
        .slice(0, limit);
    },
  };
}

async function courierLeg(script: ('ok' | 'unknown_after_create' | 'unknown_before_create')[] = ['ok']) {
  const w = world({ courierEnabled: true, providers: 'courier', cover: { fake_courier: 2_000_000 } });
  w.deps.policy = { ...DEFAULT_DELIVERY_POLICY, automatedDeliveryMaxItemValueCents: 2_000_000 };
  const q = await quoteDelivery({ caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: { start: null, end: null } }, w.deps);
  if (!q.ok) throw new Error('quote');
  w.repo.quotes.get(q.quotes[0].id)!.customerFeeCents = 0;
  const p = await prepareDelivery({ caller: renter, quoteId: q.quotes[0].id, bookingGroupId: GROUP }, w.deps);
  if (!p.ok) throw new Error(p.code);
  w.courier.createScript = [...script];
  await commitDelivery({ caller: { kind: 'system' }, shipmentId: p.shipment.id }, w.deps);
  return { w, shipment: p.shipment };
}

describe('reconcileUncertainDispatches', () => {
  it('a timeout after the provider created the job: found by our reference, recorded once, no second courier (D10)', async () => {
    const { w, shipment } = await courierLeg(['unknown_after_create']);
    expect(w.repo.intents.get(shipment.id)!.state).toBe('unknown');
    expect(w.courier.createCalls).toBe(1);
    const first = await reconcileUncertainDispatches(w.deps, queries(w));
    expect(first.outcomes).toEqual({ reconciled: 1 });
    expect(w.repo.shipments.get(shipment.id)!.status).toBe('scheduled');
    expect(w.repo.intents.get(shipment.id)!.state).toBe('succeeded');
    const second = await reconcileUncertainDispatches(w.deps, queries(w));
    expect(second.checked).toBe(0);
    expect(w.courier.createCalls).toBe(1);
    expect(w.courier.jobs.size).toBe(1);
  });

  it('nothing at the provider: staff are alerted (once), and the job never re-creates on its own', async () => {
    const { w, shipment } = await courierLeg(['unknown_before_create']);
    await reconcileUncertainDispatches(w.deps, queries(w));
    await reconcileUncertainDispatches(w.deps, queries(w));
    expect(w.courier.createCalls).toBe(1);
    expect(w.courier.jobs.size).toBe(0);
    expect(w.repo.intents.get(shipment.id)!.state).toBe('unknown');
    const alerts = [...w.repo.outbox.values()].filter((n) => n.kind === 'staff_alert' && n.data.what === 'delivery_dispatch_not_at_provider');
    expect(alerts.length).toBeGreaterThan(0);
    expect(new Set(alerts.map((a) => a.dedupeKey)).size).toBe(alerts.length);
    const perChannel = alerts.filter((a) => a.channel === 'in_app');
    expect(perChannel).toHaveLength(1);
  });

  it('a provider that cannot be reached changes nothing (next run tries again)', async () => {
    const { w, shipment } = await courierLeg(['unknown_after_create']);
    w.courier.findBehaviour = 'unknown';
    const r = await reconcileUncertainDispatches(w.deps, queries(w));
    expect(r.outcomes).toEqual({ unreachable: 1 });
    expect(w.repo.shipments.get(shipment.id)!.status).toBe('booking');
    expect(w.courier.createCalls).toBe(1);
  });
});

describe('pollTrackedShipments', () => {
  it('applies a missed update once; the next run (or a late webhook) changes nothing', async () => {
    const { w, shipment } = await courierLeg();
    const job = [...w.courier.jobs.values()][0];
    job.state = 'in_transit';
    job.stateAt = '2026-10-20T07:10:00.000Z';
    expect((await pollTrackedShipments(w.deps, queries(w))).outcomes).toEqual({ applied: 1 });
    const events = w.repo.events.length;
    expect((await pollTrackedShipments(w.deps, queries(w))).outcomes).toEqual({ duplicate: 1 });
    expect(w.repo.events.length).toBe(events);
    // The same update by webhook (no provider event id) carries the same dedupe key.
    const s = w.repo.shipments.get(shipment.id)!;
    const viaWebhook = await recordProviderEvent(
      { providerId: 'fake_courier', verified: true, dedupeKey: deliveryEventDedupeKey('fake_courier', { eventId: null, merchantReference: s.merchantReference, providerReference: s.providerReference, state: 'in_transit', stateAt: job.stateAt }), merchantReference: s.merchantReference, providerReference: s.providerReference, state: 'in_transit', stateAt: job.stateAt, source: 'provider_webhook' },
      w.deps,
    );
    expect(viaWebhook).toBe('duplicate');
  });

  it('never moves a leg backwards (D13)', async () => {
    const { w, shipment } = await courierLeg();
    const job = [...w.courier.jobs.values()][0];
    job.state = 'delivered';
    job.stateAt = '2026-10-20T08:00:00.000Z';
    await pollTrackedShipments(w.deps, queries(w));
    expect(w.repo.shipments.get(shipment.id)!.status).toBe('delivered');
    // Delivered legs are no longer polled; even if they were, an older state is stale.
    job.state = 'in_transit';
    job.stateAt = '2026-10-20T07:00:00.000Z';
    const s = w.repo.shipments.get(shipment.id)!;
    s.status = 'delivered';
    expect((await pollTrackedShipments(w.deps, { listTrackableShipments: async () => [s] })).outcomes).toEqual({ stale: 1 });
    expect(w.repo.shipments.get(shipment.id)!.status).toBe('delivered');
  });

  it('an unreachable provider is skipped without touching the leg', async () => {
    const { w, shipment } = await courierLeg();
    w.courier.getDelivery = async () => {
      throw new Error('socket hang up');
    };
    expect((await pollTrackedShipments(w.deps, queries(w))).outcomes).toEqual({ unreachable: 1 });
    expect(w.repo.shipments.get(shipment.id)!.status).toBe('scheduled');
  });
});

describe('remindReturnPickups', () => {
  it('one reminder per return leg, however often it runs', async () => {
    const w = world({ providers: 'manual' });
    const q = await quoteDelivery({ caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'return', originAddressId: RENTER_HOME, destinationAddressId: OFFICE, lines: LINES_FOR_QUOTE, window: { start: '2026-10-11T07:00:00.000Z', end: '2026-10-11T09:00:00.000Z' } }, w.deps);
    if (!q.ok) throw new Error('quote');
    w.repo.quotes.get(q.quotes[0].id)!.customerFeeCents = 0;
    w.bookings.setStatus(GROUP, 'active');
    const p = await prepareDelivery({ caller: renter, quoteId: q.quotes[0].id, bookingGroupId: GROUP }, w.deps);
    if (!p.ok) throw new Error(p.code);
    await commitDelivery({ caller: { kind: 'system' }, shipmentId: p.shipment.id }, w.deps);
    expect(w.repo.shipments.get(p.shipment.id)!.status).toBe('scheduled');
    await remindReturnPickups(w.deps, queries(w));
    await remindReturnPickups(w.deps, queries(w));
    const reminders = [...w.repo.outbox.values()].filter((n) => n.kind === 'delivery_return_reminder');
    expect(reminders.map((r) => r.channel).sort()).toEqual(['email', 'in_app', 'sms']);
    expect(reminders.every((r) => r.userId === RENTER && JSON.stringify(r.data) === '{}')).toBe(true);
  });

  it('a pickup further away than the lead time is not reminded yet', async () => {
    const w = world({ providers: 'manual' });
    const far = { id: 's-far', renterId: RENTER, items: [], leg: 'return', status: 'scheduled', window: { start: '2026-10-20T07:00:00.000Z', end: null } };
    const q: Pick<DeliveryJobQueries, 'listUpcomingReturnPickups'> = { listUpcomingReturnPickups: async (from, to) => [far].filter((s) => s.window.start >= from && s.window.start <= to) };
    expect(await remindReturnPickups(w.deps, q)).toEqual({ reminded: 0 });
  });
});

// ── Address retention ───────────────────────────────────────────────────────

const NOW = new Date('2026-10-10T00:00:00.000Z');
const OLD = '2025-01-01T00:00:00.000Z';
const addr = (id: string, createdAt = OLD): RetentionAddress => ({ id, createdAt, retainUntil: null, lat: -26.107612, lng: 28.056734, suburb: 'Sandton', city: 'Johannesburg', province: 'Gauteng' });
type ShipmentRef = Extract<AddressReference, { kind: 'shipment' }>;
const ship = (addressId: string, status: ShipmentRef['status'], extra: Partial<ShipmentRef> = {}): AddressReference => ({
  addressId,
  kind: 'shipment',
  shipmentId: `s-${addressId}-${status}`,
  quoteId: `q-${addressId}`,
  status,
  acceptedAt: null,
  updatedAt: OLD,
  openIncident: false,
  ...extra,
});

describe('addressPurgeDecision (R-41, D-46)', () => {
  it('never purges an address an open shipment uses, however old', () => {
    for (const status of ['prepared', 'booking', 'scheduled', 'courier_assigned', 'collected', 'in_transit', 'courier_at_dropoff', 'delivery_attempt_failed', 'return_to_sender', 'lost', 'damaged', 'incident_under_review'] as const) {
      expect(addressPurgeDecision(addr('a'), [ship('a', status)], NOW)).toMatchObject({ purge: false, reason: 'open_shipment' });
    }
    // Delivered but not yet accepted by the renter is still open.
    expect(addressPurgeDecision(addr('a'), [ship('a', 'delivered')], NOW)).toMatchObject({ purge: false, reason: 'open_shipment' });
  });

  it('keeps an address with an open incident, a live quote or a paid quote not yet dispatched', () => {
    expect(addressPurgeDecision(addr('a'), [ship('a', 'delivered', { acceptedAt: OLD, openIncident: true })], NOW)).toMatchObject({ purge: false, reason: 'open_incident' });
    expect(addressPurgeDecision(addr('a'), [{ addressId: 'a', kind: 'quote', quoteId: 'q1', status: 'active', createdAt: OLD, expiresAt: '2026-10-10T00:30:00.000Z' }], NOW)).toMatchObject({ purge: false, reason: 'live_quote' });
    expect(addressPurgeDecision(addr('a'), [{ addressId: 'a', kind: 'quote', quoteId: 'q1', status: 'paid', createdAt: OLD, expiresAt: OLD }], NOW)).toMatchObject({ purge: false, reason: 'paid_quote' });
  });

  it('keeps it for the retention period after the last leg closed, then purges', () => {
    const recent = new Date(NOW.getTime() - 10 * 86_400_000).toISOString();
    const d = addressPurgeDecision(addr('a'), [ship('a', 'cancelled', { updatedAt: recent })], NOW, 180);
    expect(d).toMatchObject({ purge: false, reason: 'recent_activity' });
    expect(addressPurgeDecision(addr('a'), [ship('a', 'cancelled'), ship('a', 'delivered', { acceptedAt: OLD }), { addressId: 'a', kind: 'quote', quoteId: 'q-a', status: 'paid', createdAt: OLD, expiresAt: OLD }], NOW, 180)).toEqual({ purge: true });
    expect(addressPurgeDecision(addr('a'), [], NOW, 180)).toEqual({ purge: true });
  });

  it('a purged address keeps the area only', () => {
    const f = redactedAddressFields({ ...addr('a') }, NOW.toISOString());
    expect(f).toEqual({ formatted_address: 'Sandton, Johannesburg', contact_name: '', contact_phone: '', instructions: null, lat: -26.11, lng: 28.06, redacted_at: NOW.toISOString() });
  });
});

class MemoryRetention implements AddressRetentionStore {
  redacted = new Map<string, Record<string, unknown>>();
  retain = new Map<string, string>();
  constructor(
    public addresses: RetentionAddress[],
    public refs: AddressReference[],
  ) {}
  async listDue(now: string, createdBefore: string, limit: number) {
    return this.addresses
      .filter((a) => !this.redacted.has(a.id))
      .filter((a) => {
        const r = this.retain.get(a.id) ?? a.retainUntil;
        return r ? r < now : a.createdAt < createdBefore;
      })
      .slice(0, limit);
  }
  async references(ids: readonly string[]) {
    return this.refs.filter((r) => ids.includes(r.addressId));
  }
  async redact(a: RetentionAddress, now: string) {
    if (this.redacted.has(a.id)) return false;
    this.redacted.set(a.id, redactedAddressFields(a, now));
    return true;
  }
  async setRetainUntil(id: string, until: string) {
    this.retain.set(id, until);
  }
}

describe('purgeDeliveryAddresses', () => {
  it('purges only closed, expired addresses; never one an open shipment uses; idempotent', async () => {
    const store = new MemoryRetention(
      [addr('open-in-transit'), addr('open-unaccepted'), addr('closed-old'), addr('closed-recent'), addr('incident'), addr('paid-not-sent'), addr('brand-new', '2026-10-01T00:00:00.000Z')],
      [
        ship('open-in-transit', 'in_transit'),
        ship('open-unaccepted', 'delivered'),
        ship('closed-old', 'delivered', { acceptedAt: OLD }),
        ship('closed-recent', 'cancelled', { updatedAt: '2026-09-01T00:00:00.000Z' }),
        ship('incident', 'delivered', { acceptedAt: OLD, openIncident: true }),
        { addressId: 'paid-not-sent', kind: 'quote', quoteId: 'qp', status: 'paid', createdAt: OLD, expiresAt: OLD },
      ],
    );
    const first = await purgeDeliveryAddresses(store, NOW, { retentionDays: 180 });
    expect([...store.redacted.keys()]).toEqual(['closed-old']);
    expect(first).toMatchObject({ purged: 1, kept: { open_shipment: 2, recent_activity: 1, open_incident: 1, paid_quote: 1 } });
    const second = await purgeDeliveryAddresses(store, NOW, { retentionDays: 180 });
    expect(second.purged).toBe(0);
    expect([...store.redacted.keys()]).toEqual(['closed-old']);
    // Open shipments are re-checked tomorrow, recent ones when their retention ends.
    expect(store.retain.get('open-in-transit')).toBe('2026-10-11T00:00:00.000Z');
    expect(store.retain.get('closed-recent')).toBe(new Date(new Date('2026-09-01T00:00:00.000Z').getTime() + 180 * 86_400_000).toISOString());
    // Even a year later, an address an open shipment still uses is untouched.
    await purgeDeliveryAddresses(store, new Date('2027-10-10T00:00:00.000Z'), { retentionDays: 180 });
    expect(store.redacted.has('open-in-transit')).toBe(false);
    expect(store.redacted.has('open-unaccepted')).toBe(false);
    expect(store.redacted.has('closed-recent')).toBe(true);
  });
});
