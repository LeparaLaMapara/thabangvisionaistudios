/**
 * In-memory adapters for the delivery ports. They copy the database's
 * semantics from migration 076: compare-and-set on shipment status and on the
 * dispatch intent, one canonical event per dedupe key, append-only custody,
 * one incident per dedupe key, one journal per idempotency key, one outbox row
 * per dedupe key, one refund obligation per key, and a transition is applied
 * all-or-nothing. Test doubles, not a live integration.
 */
import type { Clock, ProviderCallResult } from '@/lib/core/ports';
import { isBalanced, type Journal } from '@/lib/core/rental/ledger';
import type { OutboxMessage } from '@/lib/core/rental/notifications';
import type { BookingStatus } from '@/lib/core/rental/state';
import type { HoldingForTrust, RenterFacts } from '@/lib/core/rental/trust';
import type { DeliveryCapabilities } from '@/lib/core/delivery/capabilities';
import type { CustodyEvent } from '@/lib/core/delivery/custody';
import type { DeliveryIncident, IncidentStatus } from '@/lib/core/delivery/incidents';
import type {
  CreateDeliveryRequest,
  DeliveryInsurancePort,
  DeliveryPoint,
  DeliveryPort,
  ProviderDelivery,
  ProviderQuote,
  ServiceabilityResult,
} from '@/lib/core/delivery/port';
import type { CustomerDeliveryQuote, QuoteStatus } from '@/lib/core/delivery/quote';
import type {
  DeliveryAddressStore,
  DeliveryBookingLine,
  DeliveryBookingPort,
  DeliveryBookingView,
  DeliveryDeps,
  DeliveryProof,
  DeliveryProviderRegistry,
  DeliveryRepository,
  DispatchIntent,
  DispatchIntentState,
  NewShipment,
  ReconciliationRecord,
  RenterTrustPort,
  Shipment,
  ShipmentPatch,
  ShipmentTransition,
  TransitionResult,
  UnusedQuoteRefund,
} from '@/lib/core/delivery/repository';
import { InMemoryManualTaskStore, createManualDeliveryAdapter } from '@/lib/delivery/manual';

export class FakeClock implements Clock {
  constructor(public t: Date) {}
  now(): Date {
    return new Date(this.t);
  }
  advanceMinutes(m: number): void {
    this.t = new Date(this.t.getTime() + m * 60_000);
  }
}

let seq = 0;
export const nextId = (): string => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

export interface RefundRow {
  key: string;
  amountCents: number;
  paidReference: string;
  userId: string;
}

export class InMemoryDeliveryRepo implements DeliveryRepository {
  quotes = new Map<string, CustomerDeliveryQuote>();
  shipments = new Map<string, Shipment>();
  intents = new Map<string, DispatchIntent>();
  events: { shipmentId: string; from: string; to: string; dedupeKey: string | null; source: string }[] = [];
  custody: CustodyEvent[] = [];
  proofs: DeliveryProof[] = [];
  incidents = new Map<string, DeliveryIncident & { resolution?: string }>();
  journals = new Map<string, Journal>();
  outbox = new Map<string, OutboxMessage>();
  refunds = new Map<string, RefundRow>();
  reconciliations = new Map<string, ReconciliationRecord>();
  /** Make the next N transitions fail with an exception (simulates a DB error mid-way). */
  failNextTransitions = 0;
  /** Fail (throw) any transition this predicate matches: a database error at that exact write. */
  failWhen: ((t: ShipmentTransition) => boolean) | null = null;

  private postJournal(j: Journal): void {
    if (!isBalanced(j)) throw new Error(`unbalanced ${j.idempotencyKey}`);
    if (!this.journals.has(j.idempotencyKey)) this.journals.set(j.idempotencyKey, j);
  }
  private postNotice(n: OutboxMessage): void {
    if (!this.outbox.has(n.dedupeKey)) this.outbox.set(n.dedupeKey, n);
  }

  async saveQuote(q: Omit<CustomerDeliveryQuote, 'id' | 'createdAt'>): Promise<CustomerDeliveryQuote> {
    const row: CustomerDeliveryQuote = { ...q, id: nextId(), createdAt: new Date().toISOString() };
    this.quotes.set(row.id, row);
    return { ...row };
  }
  async getQuote(id: string): Promise<CustomerDeliveryQuote | null> {
    const q = this.quotes.get(id);
    return q ? { ...q } : null;
  }
  async setQuoteStatus(id: string, from: readonly QuoteStatus[], to: QuoteStatus, patch: { paidReference?: string; bookingGroupId?: string } = {}): Promise<boolean> {
    const q = this.quotes.get(id);
    if (!q || !from.includes(q.status)) return false;
    q.status = to;
    if (patch.paidReference) {
      q.paidReference = patch.paidReference;
      // Contract: a paid quote marks the shipments made from it as paid.
      for (const s of this.shipments.values()) if (s.quoteId === id) s.paidReference = patch.paidReference;
    }
    if (patch.bookingGroupId) q.bookingGroupId = patch.bookingGroupId;
    return true;
  }

  async getShipment(id: string): Promise<Shipment | null> {
    const s = this.shipments.get(id);
    return s ? structuredClone(s) : null;
  }
  async findShipment(by: { merchantReference: string } | { providerId: string; providerReference: string }): Promise<Shipment | null> {
    for (const s of this.shipments.values()) {
      if ('merchantReference' in by ? s.merchantReference === by.merchantReference : s.providerId === by.providerId && s.providerReference === by.providerReference) return structuredClone(s);
    }
    return null;
  }
  async listShipments(groupId: string): Promise<Shipment[]> {
    return [...this.shipments.values()].filter((s) => s.bookingGroupId === groupId).map((s) => structuredClone(s));
  }
  async createShipment(
    s: NewShipment,
    intent: Omit<DispatchIntent, 'id' | 'shipmentId' | 'attempts' | 'claimedAt' | 'lastError' | 'providerReference' | 'state'>,
  ): Promise<{ shipment: Shipment; intent: DispatchIntent; created: boolean }> {
    for (const x of this.shipments.values()) {
      // 080: one row per order, leg, ORIGIN and attempt (our site = null, as before 080).
      if (x.merchantReference === s.merchantReference || (x.bookingGroupId === s.bookingGroupId && x.leg === s.leg && (x.originOwnerId ?? null) === (s.originOwnerId ?? null) && x.attempt === s.attempt)) {
        return { shipment: structuredClone(x), intent: { ...(this.intents.get(x.id) as DispatchIntent) }, created: false };
      }
    }
    const row: Shipment = {
      ...s,
      id: nextId(),
      createdAt: new Date().toISOString(),
      providerReference: null,
      trackingReference: null,
      trackingUrl: null,
      courierName: null,
      scheduledAt: null,
      collectedAt: null,
      deliveredAt: null,
      acceptedAt: null,
      lastProviderStateAt: null,
      providerCostCents: null,
      accruedCostCents: 0,
    };
    const i: DispatchIntent = { ...intent, id: nextId(), shipmentId: row.id, attempts: 0, claimedAt: null, lastError: null, providerReference: null, state: 'pending' };
    this.shipments.set(row.id, row);
    this.intents.set(row.id, i);
    return { shipment: structuredClone(row), intent: { ...i }, created: true };
  }
  async getDispatchIntent(shipmentId: string): Promise<DispatchIntent | null> {
    const i = this.intents.get(shipmentId);
    return i ? { ...i } : null;
  }
  async claimDispatch(intentId: string, from: readonly DispatchIntentState[], now: string, staleBefore: string): Promise<boolean> {
    const i = [...this.intents.values()].find((x) => x.id === intentId);
    if (!i) return false;
    const claimable = i.state === 'claimed' ? from.includes('claimed') && (!i.claimedAt || i.claimedAt < staleBefore) : from.includes(i.state);
    if (!claimable) return false;
    i.state = 'claimed';
    i.claimedAt = now;
    i.attempts += 1;
    return true;
  }
  async finishDispatch(intentId: string, to: 'succeeded' | 'unknown' | 'rejected', patch: { providerReference?: string | null; lastError?: string | null }): Promise<void> {
    const i = [...this.intents.values()].find((x) => x.id === intentId);
    if (!i) return;
    i.state = to;
    if (patch.providerReference !== undefined) i.providerReference = patch.providerReference;
    if (patch.lastError !== undefined) i.lastError = patch.lastError;
  }

  async saveRecipientPin(shipmentId: string, pin: string): Promise<void> {
    const s = this.shipments.get(shipmentId);
    if (s) this.shipments.set(shipmentId, { ...s, recipientPin: pin });
  }

  async transitionShipment(t: ShipmentTransition): Promise<TransitionResult> {
    if (this.failNextTransitions > 0) {
      this.failNextTransitions -= 1;
      throw new Error('database unavailable');
    }
    if (this.failWhen?.(t)) {
      this.failWhen = null;
      throw new Error('database unavailable');
    }
    const s = this.shipments.get(t.shipmentId);
    if (!s) return 'conflict';
    if (t.event.dedupeKey && this.events.some((e) => e.dedupeKey === t.event.dedupeKey)) return 'duplicate';
    if (!t.from.includes(s.status)) return 'conflict';
    // All-or-nothing: validate everything before changing anything.
    for (const j of t.journals) if (!isBalanced(j)) throw new Error('unbalanced');
    this.events.push({ shipmentId: s.id, from: s.status, to: t.to, dedupeKey: t.event.dedupeKey, source: t.event.source });
    s.status = t.to;
    Object.assign(s, t.patch as ShipmentPatch);
    for (const c of t.custody) if (!this.custody.some((x) => x.dedupeKey === c.dedupeKey)) this.custody.push(structuredClone(c));
    for (const p of t.proofs) if (!this.proofs.some((x) => x.shipmentId === p.shipmentId && x.kind === p.kind && x.ref === p.ref)) this.proofs.push(p);
    for (const i of t.incidents) if (![...this.incidents.values()].some((x) => x.dedupeKey === i.dedupeKey)) this.incidents.set(i.id, structuredClone(i));
    for (const j of t.journals) this.postJournal(j);
    for (const n of t.notices) this.postNotice(n);
    if (t.refund && !this.refunds.has(t.refund.key)) this.refunds.set(t.refund.key, { key: t.refund.key, amountCents: t.refund.amountCents, paidReference: t.refund.paidReference, userId: t.refund.userId });
    if (t.quoteStatus) {
      const q = this.quotes.get(t.quoteStatus.quoteId);
      if (q) q.status = t.quoteStatus.to;
    }
    return 'applied';
  }
  async hasEvent(dedupeKey: string): Promise<boolean> {
    return this.events.some((e) => e.dedupeKey === dedupeKey);
  }
  async listCustody(shipmentId: string): Promise<CustodyEvent[]> {
    return this.custody.filter((c) => c.shipmentId === shipmentId).map((c) => structuredClone(c));
  }
  async listIncidents(groupId: string): Promise<DeliveryIncident[]> {
    return [...this.incidents.values()].filter((i) => i.bookingGroupId === groupId).map((i) => structuredClone(i));
  }
  async getIncident(id: string): Promise<DeliveryIncident | null> {
    const i = this.incidents.get(id);
    return i ? structuredClone(i) : null;
  }
  async openIncident(i: DeliveryIncident, notices: OutboxMessage[]): Promise<'inserted' | 'duplicate'> {
    if ([...this.incidents.values()].some((x) => x.dedupeKey === i.dedupeKey)) return 'duplicate';
    this.incidents.set(i.id, structuredClone(i));
    for (const n of notices) this.postNotice(n);
    return 'inserted';
  }
  async updateIncident(id: string, from: readonly IncidentStatus[], patch: Partial<Pick<DeliveryIncident, 'status' | 'providerCaused' | 'liability'>> & { resolution?: string; resolvedBy?: string | null }): Promise<boolean> {
    const i = this.incidents.get(id);
    if (!i || !from.includes(i.status)) return false;
    Object.assign(i, patch);
    return true;
  }
  async saveReconciliation(r: ReconciliationRecord, journals: Journal[], notices: OutboxMessage[], patch: ShipmentPatch): Promise<'inserted' | 'duplicate'> {
    const key = `${r.shipmentId}:${r.providerInvoiceRef}`;
    if (this.reconciliations.has(key)) return 'duplicate';
    this.reconciliations.set(key, r);
    for (const j of journals) this.postJournal(j);
    for (const n of notices) this.postNotice(n);
    const s = this.shipments.get(r.shipmentId);
    if (s) Object.assign(s, patch);
    return 'inserted';
  }
  async post(journals: Journal[], notices: OutboxMessage[]): Promise<void> {
    for (const j of journals) this.postJournal(j);
    for (const n of notices) this.postNotice(n);
  }

  async refundUnusedQuote(r: UnusedQuoteRefund): Promise<'applied' | 'conflict'> {
    // Same contract as delivery_refund_quote (076): CAS paid -> refunded while no live leg uses it.
    const q = this.quotes.get(r.quoteId);
    if (!q || q.status !== 'paid') return 'conflict';
    if ([...this.shipments.values()].some((s) => s.quoteId === r.quoteId && s.status !== 'cancelled' && s.status !== 'failed')) return 'conflict';
    for (const j of r.journals) if (!isBalanced(j)) throw new Error('unbalanced');
    for (const j of r.journals) this.postJournal(j);
    for (const n of r.notices) this.postNotice(n);
    if (r.refund && !this.refunds.has(r.refund.key)) this.refunds.set(r.refund.key, { key: r.refund.key, amountCents: r.refund.amountCents, paidReference: r.refund.paidReference, userId: r.refund.userId });
    q.status = 'refunded';
    return 'applied';
  }

  /** Test helper: outbox kinds sent to a user. */
  noticesFor(userId: string): string[] {
    return [...this.outbox.values()].filter((n) => n.userId === userId).map((n) => `${n.kind}:${n.channel}`);
  }
}

export class FakeBookings implements DeliveryBookingPort {
  groups = new Map<string, DeliveryBookingView>();
  async getGroup(id: string): Promise<DeliveryBookingView | null> {
    const g = this.groups.get(id);
    return g ? structuredClone(g) : null;
  }
  setStatus(groupId: string, status: BookingStatus): void {
    const g = this.groups.get(groupId);
    if (g) for (const l of g.lines) l.status = status;
  }
}

export const cleanRenter: RenterFacts = {
  emailVerified: true,
  phoneVerified: true,
  identityApproved: true,
  bankValidated: true,
  cleanReturns: 1,
  cleanReturnValueCents: 1_000_000,
  firstCleanReturnAt: '2026-01-01T00:00:00.000Z',
  openDisputes: 0,
  overdueNow: 0,
  overdueEscalated: 0,
  recentLateReturns: 0,
  fraudFlags: 0,
  suspended: false,
  manualReview: false,
};

export class FakeTrust implements RenterTrustPort {
  facts = new Map<string, RenterFacts>();
  holdings = new Map<string, HoldingForTrust[]>();
  async getTrustInputs(renterId: string): Promise<{ facts: RenterFacts; holdings: HoldingForTrust[] }> {
    return { facts: this.facts.get(renterId) ?? cleanRenter, holdings: this.holdings.get(renterId) ?? [] };
  }
}

export class FakeAddresses implements DeliveryAddressStore {
  points = new Map<string, DeliveryPoint & { userId: string | null }>();
  async getPoint(id: string): Promise<(DeliveryPoint & { userId: string | null }) | null> {
    const p = this.points.get(id);
    return p ? { ...p } : null;
  }
}

export const ALL_CAPS: DeliveryCapabilities = {
  onDemand: true,
  scheduled: true,
  reverseLogistics: true,
  liveTracking: true,
  trackingWebhooks: true,
  pickupConfirmation: true,
  proofOfDelivery: true,
  signature: true,
  recipientPin: true,
  declaredValueSupport: true,
  verifiedTransitCover: true,
  cancellation: true,
  noLeaveAtDoor: true,
  idempotentCreate: true,
};

type CreateBehaviour = 'ok' | 'unknown_after_create' | 'unknown_before_create' | 'rejected' | 'throw_after_create';

/**
 * A fake courier. The provider side keeps jobs by OUR merchant reference and
 * refuses a duplicate (idempotent create), like a real provider would; the
 * test asserts how many jobs exist at the provider.
 */
export class FakeCourier implements DeliveryPort {
  readonly kind = 'courier' as const;
  readonly mode = 'production' as const;
  capabilities: DeliveryCapabilities = { ...ALL_CAPS };
  jobs = new Map<string, ProviderDelivery>();
  createCalls = 0;
  findCalls = 0;
  costCents = 12_000;
  cancelFeeCents = 0;
  serviceable: ServiceabilityResult = { serviceable: true, reason: null };
  /** Scripted behaviours for successive createDelivery calls. */
  createScript: CreateBehaviour[] = [];
  findBehaviour: 'ok' | 'unknown' = 'ok';
  /** A drop-off PIN the fake provider makes on create (like Uber Direct). */
  recipientPin: string | null = null;
  down = false;
  constructor(public readonly providerId = 'fake_courier') {}

  async checkServiceability(): Promise<ProviderCallResult<ServiceabilityResult>> {
    if (this.down) return { ok: false, kind: 'unknown', message: 'timeout' };
    return { ok: true, value: this.serviceable };
  }
  async quote(r: { window: { start: string | null; end: string | null } }): Promise<ProviderCallResult<ProviderQuote>> {
    if (this.down) return { ok: false, kind: 'unknown', message: 'timeout' };
    return { ok: true, value: { providerId: this.providerId, providerQuoteRef: `q-${this.providerId}`, providerCostCents: this.costCents, expiresAt: '2099-01-01T00:00:00.000Z', window: r.window } };
  }
  async createDelivery(r: CreateDeliveryRequest): Promise<ProviderCallResult<ProviderDelivery>> {
    this.createCalls += 1;
    const b = this.createScript.shift() ?? 'ok';
    if (b === 'unknown_before_create') return { ok: false, kind: 'unknown', message: 'timeout before reaching provider' };
    if (b === 'rejected') return { ok: false, kind: 'rejected', message: 'address not serviceable' };
    const existing = this.jobs.get(r.merchantReference);
    const job = existing ?? { providerReference: `job-${this.jobs.size + 1}`, merchantReference: r.merchantReference, state: 'pending', stateAt: null, trackingUrl: 'https://track.example/abc', courierName: null, proof: [], ...(this.recipientPin ? { recipientPin: this.recipientPin } : {}) };
    this.jobs.set(r.merchantReference, job);
    if (b === 'unknown_after_create') return { ok: false, kind: 'unknown', message: 'timeout after create' };
    if (b === 'throw_after_create') throw new Error('socket hang up');
    return { ok: true, value: { ...job } };
  }
  async findByMerchantReference(ref: string): Promise<ProviderCallResult<ProviderDelivery | null>> {
    this.findCalls += 1;
    if (this.findBehaviour === 'unknown') return { ok: false, kind: 'unknown', message: 'timeout' };
    const j = this.jobs.get(ref);
    return { ok: true, value: j ? { ...j } : null };
  }
  async getDelivery(ref: string): Promise<ProviderCallResult<ProviderDelivery>> {
    const j = [...this.jobs.values()].find((x) => x.providerReference === ref);
    return j ? { ok: true, value: { ...j } } : { ok: false, kind: 'rejected', message: 'not found' };
  }
  async cancelDelivery(ref: string): Promise<ProviderCallResult<{ cancelled: boolean; feeCents: number }>> {
    const j = [...this.jobs.values()].find((x) => x.providerReference === ref);
    if (!j) return { ok: false, kind: 'rejected', message: 'not found' };
    j.state = 'cancelled';
    return { ok: true, value: { cancelled: true, feeCents: this.cancelFeeCents } };
  }
  async getTracking(): Promise<ProviderCallResult<{ state: 'pending'; etaAt: null; location: null; trackingUrl: null }>> {
    return { ok: true, value: { state: 'pending', etaAt: null, location: null, trackingUrl: null } };
  }
}

/** Insurance that covers the listed providers up to a limit. */
export function fakeInsurance(covered: Record<string, number>): DeliveryInsurancePort {
  return {
    async coverFor({ providerId, items }) {
      const max = covered[providerId];
      if (max === undefined) return { covered: false, policyRef: null, maxItemValueCents: 0, reason: 'no_policy' };
      return { covered: true, policyRef: `POL-${providerId}`, maxItemValueCents: max, reason: items.some((i) => i.replacementValueCents > max) ? 'limit' : null };
    },
  };
}

export function registry(ports: DeliveryPort[], allowSandbox = false): DeliveryProviderRegistry {
  return { list: () => ports, get: (id) => ports.find((p) => p.providerId === id) ?? null, allowSandbox };
}

export const RENTER = '00000000-0000-4000-8000-0000000000a1';
export const OTHER_USER = '00000000-0000-4000-8000-0000000000a2';
export const OWNER_A = '00000000-0000-4000-8000-0000000000b1';
export const OWNER_B = '00000000-0000-4000-8000-0000000000b2';
export const STAFF = '00000000-0000-4000-8000-0000000000c1';
export const GROUP = '00000000-0000-4000-8000-0000000000d1';

export const OFFICE = 'addr-office';
export const RENTER_HOME = 'addr-renter';
export const OUT_OF_AREA = 'addr-durban';

export function line(p: Partial<DeliveryBookingLine> & { bookingId: string; rentalId: string }): DeliveryBookingLine {
  return {
    ownerId: OWNER_A,
    serialNumber: `SN-${p.rentalId}`,
    status: 'confirmed',
    unitReplacementValueCents: 1_500_000,
    quantity: 1,
    startDate: '2026-10-20',
    endDate: '2026-10-22',
    driverLabel: 'camera equipment',
    weightGrams: 2000,
    containsLithium: true,
    ...p,
  };
}

export interface World {
  deps: DeliveryDeps;
  repo: InMemoryDeliveryRepo;
  bookings: FakeBookings;
  trust: FakeTrust;
  addresses: FakeAddresses;
  clock: FakeClock;
  courier: FakeCourier;
  manual: DeliveryPort;
  tasks: InMemoryManualTaskStore;
}

/** A booked, paid order with two items from two owners, delivered in Gauteng. */
export function world(opts: { courierEnabled?: boolean; ownFleetEnabled?: boolean; providers?: 'manual' | 'courier' | 'both'; cover?: Record<string, number> } = {}): World {
  const repo = new InMemoryDeliveryRepo();
  const bookings = new FakeBookings();
  const trust = new FakeTrust();
  const addresses = new FakeAddresses();
  const clock = new FakeClock(new Date('2026-10-10T08:00:00.000Z'));
  const courier = new FakeCourier();
  const tasks = new InMemoryManualTaskStore();
  const manual = createManualDeliveryAdapter(tasks, { now: () => clock.now() });
  addresses.points.set(OFFICE, { placeId: OFFICE, lat: -26.1929, lng: 28.0305, formattedAddress: '99 Smith Street, Braamfontein', suburb: 'Braamfontein', city: 'Johannesburg', postalCode: '2001', province: 'Gauteng', contactName: 'Desk', contactPhone: '0000000000', instructions: null, userId: null });
  addresses.points.set(RENTER_HOME, { placeId: RENTER_HOME, lat: -26.1076, lng: 28.0567, formattedAddress: '1 Test Road, Sandton', suburb: 'Sandton', city: 'Johannesburg', postalCode: '2196', province: 'Gauteng', contactName: 'Thandi', contactPhone: '0000000001', instructions: 'Gate 2', userId: RENTER });
  addresses.points.set(OUT_OF_AREA, { placeId: OUT_OF_AREA, lat: -29.8587, lng: 31.0218, formattedAddress: '1 Beach Road, Durban', suburb: 'Durban Central', city: 'Durban', postalCode: '4001', province: 'KwaZulu-Natal', contactName: 'Thandi', contactPhone: '0000000001', instructions: null, userId: RENTER });
  bookings.groups.set(GROUP, {
    bookingGroupId: GROUP,
    renterId: RENTER,
    paymentVerified: true,
    paymentReference: 'pay-ref-1',
    lines: [line({ bookingId: 'bk-1', rentalId: 'cam-1', ownerId: OWNER_A }), line({ bookingId: 'bk-2', rentalId: 'lens-1', ownerId: OWNER_B, unitReplacementValueCents: 800_000 })],
  });
  const which = opts.providers ?? 'both';
  const ports = which === 'manual' ? [manual] : which === 'courier' ? [courier] : [courier, manual];
  const deps: DeliveryDeps = {
    repo,
    bookings,
    trust,
    addresses,
    providers: registry(ports),
    insurance: fakeInsurance(opts.cover ?? {}),
    clock,
    flags: { courierEnabled: opts.courierEnabled ?? false, ownFleetEnabled: opts.ownFleetEnabled ?? true },
    newId: nextId,
  };
  return { deps, repo, bookings, trust, addresses, clock, courier, manual, tasks };
}

export const LINES_FOR_QUOTE = [
  { rentalId: 'cam-1', bookingId: 'bk-1', unitReplacementValueCents: 1_500_000, quantity: 1, startDate: '2026-10-20', endDate: '2026-10-22', driverLabel: 'camera equipment', weightGrams: 2000, containsLithium: true },
  { rentalId: 'lens-1', bookingId: 'bk-2', unitReplacementValueCents: 800_000, quantity: 1, startDate: '2026-10-20', endDate: '2026-10-22', driverLabel: 'camera equipment', weightGrams: 900, containsLithium: false },
];
