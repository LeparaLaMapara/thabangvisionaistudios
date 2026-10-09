/**
 * POST /api/webhooks/delivery/[provider] at route level, with a fake courier
 * parser registered through the parser registry (lib/delivery/webhooks.ts)
 * and the core inbox + use cases running on in-memory adapters.
 *
 *  D11 - an invalid signature is refused (401) and NOTHING is stored or applied.
 *  D12 - a replayed webhook is stored once and applied once.
 *  D13 - an out-of-order webhook cannot move a leg backwards.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { InMemoryDeliveryInbox } from '@/lib/delivery/inbox';
import type { InMemoryDeliveryRepo } from './helpers/delivery-fakes';

const state = vi.hoisted(() => ({ inbox: null as unknown, repo: null as unknown, logs: [] as unknown[], dispatched: 0 }));

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}), createClient: async () => ({}) }));
vi.mock('@/lib/delivery/repos', () => ({
  SupabaseDeliveryInbox: function SupabaseDeliveryInbox() {
    return state.inbox;
  },
  SupabaseDeliveryRepository: function SupabaseDeliveryRepository() {
    return state.repo;
  },
}));
vi.mock('@/lib/data/events', () => ({ logEvent: (e: unknown) => state.logs.push(e) }));
vi.mock('@/lib/rental/notify', () => ({
  dispatchOutbox: async () => {
    state.dispatched += 1;
    return {};
  },
}));

const { POST } = await import('@/app/api/webhooks/delivery/[provider]/route');
const W = await import('@/lib/delivery/webhooks');
const { prepareDelivery, quoteDelivery, commitDelivery } = await import('@/lib/core/delivery/use-cases');
const { GROUP, LINES_FOR_QUOTE, OFFICE, RENTER, RENTER_HOME, world } = await import('./helpers/delivery-fakes');
const { DEFAULT_DELIVERY_POLICY } = await import('@/lib/core/delivery/policy');

const SECRET = 'test-webhook-secret';
process.env.FAKE_COURIER_WEBHOOK_SECRET = SECRET;

function registerFakeParser(): void {
  W._resetDeliveryWebhookParsers();
  W.registerDeliveryWebhookParser('fake_courier', (env) => {
    const secret = env.FAKE_COURIER_WEBHOOK_SECRET;
    if (!secret) return null;
    return {
      providerId: 'fake_courier',
      verify: (raw, headers) => W.constantTimeEqual(W.hmacSha256(secret, raw, 'hex'), headers['x-fake-signature'] ?? ''),
      parse: (raw) => {
        const j = JSON.parse(raw) as { id: string; ref: string; state: 'in_transit' | 'delivered' | 'courier_assigned' | 'collected'; at: string };
        return { eventId: j.id, merchantReference: j.ref, providerReference: null, state: j.state, stateAt: j.at, trackingUrl: null, courierName: null, proof: [], minimal: { id: j.id, state: j.state, at: j.at } };
      },
    };
  });
}

function req(provider: string, body: string, signature: string | null): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== null) headers['X-Fake-Signature'] = signature;
  return new NextRequest(`http://localhost:3000/api/webhooks/delivery/${provider}`, { method: 'POST', body, headers });
}
const ctx = (provider: string) => ({ params: Promise.resolve({ provider }) });
const sign = (body: string) => W.hmacSha256(SECRET, body, 'hex');

/** A dispatched courier leg to send webhooks about. */
async function dispatched() {
  const w = world({ courierEnabled: true, providers: 'courier', cover: { fake_courier: 2_000_000 } });
  w.deps.policy = { ...DEFAULT_DELIVERY_POLICY, automatedDeliveryMaxItemValueCents: 2_000_000 };
  const q = await quoteDelivery({ caller: { kind: 'renter', userId: RENTER }, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: { start: null, end: null } }, w.deps);
  if (!q.ok) throw new Error('quote failed');
  // Free leg so commit does not need a payment reference for the fee.
  const quote = w.repo.quotes.get(q.quotes[0].id)!;
  quote.customerFeeCents = 0;
  const prep = await prepareDelivery({ caller: { kind: 'renter', userId: RENTER }, quoteId: quote.id, bookingGroupId: GROUP }, w.deps);
  if (!prep.ok) throw new Error(prep.code);
  const c = await commitDelivery({ caller: { kind: 'system' }, shipmentId: prep.shipment.id }, w.deps);
  if (!c.ok) throw new Error(c.code);
  return { w, shipment: prep.shipment };
}

let inbox: InMemoryDeliveryInbox;
let repo: InMemoryDeliveryRepo;

beforeEach(() => {
  registerFakeParser();
  state.logs = [];
  state.dispatched = 0;
});

async function setup() {
  const d = await dispatched();
  repo = d.w.repo;
  inbox = new InMemoryDeliveryInbox(() => d.w.clock.now());
  state.inbox = inbox;
  state.repo = repo;
  return d;
}

describe('D11 - invalid webhook signature is rejected and never stored', () => {
  it('a wrong signature gets 401: no inbox row, no event, no state change', async () => {
    const { shipment } = await setup();
    const before = repo.shipments.get(shipment.id)!.status;
    const eventsBefore = repo.events.length;
    const body = JSON.stringify({ id: 'e1', ref: shipment.merchantReference, state: 'delivered', at: '2026-10-20T08:00:00Z' });
    const res = await POST(req('fake_courier', body, sign(body + 'tampered')), ctx('fake_courier'));
    expect(res.status).toBe(401);
    expect(inbox.rows).toHaveLength(0);
    expect(repo.events).toHaveLength(eventsBefore);
    expect(repo.shipments.get(shipment.id)!.status).toBe(before);
  });

  it('a missing signature, or the signature of another body, is also 401 and stores nothing', async () => {
    const { shipment } = await setup();
    const body = JSON.stringify({ id: 'e1', ref: shipment.merchantReference, state: 'delivered', at: '2026-10-20T08:00:00Z' });
    expect((await POST(req('fake_courier', body, null), ctx('fake_courier'))).status).toBe(401);
    const other = JSON.stringify({ id: 'e2', ref: shipment.merchantReference, state: 'in_transit', at: '2026-10-20T07:00:00Z' });
    expect((await POST(req('fake_courier', body, sign(other)), ctx('fake_courier'))).status).toBe(401);
    expect(inbox.rows).toHaveLength(0);
  });

  it('unknown provider → 404; known but unconfigured → 503; oversized → 413; none stored', async () => {
    await setup();
    const body = '{}';
    expect((await POST(req('nobody', body, sign(body)), ctx('nobody'))).status).toBe(404);
    expect((await POST(req('../etc', body, sign(body)), ctx('../etc'))).status).toBe(404);
    const saved = process.env.FAKE_COURIER_WEBHOOK_SECRET;
    delete process.env.FAKE_COURIER_WEBHOOK_SECRET;
    expect((await POST(req('fake_courier', body, sign(body)), ctx('fake_courier'))).status).toBe(503);
    process.env.FAKE_COURIER_WEBHOOK_SECRET = saved;
    const big = JSON.stringify({ pad: 'x'.repeat(300 * 1024) });
    expect((await POST(req('fake_courier', big, sign(big)), ctx('fake_courier'))).status).toBe(413);
    expect(inbox.rows).toHaveLength(0);
  });

  it('a parser that throws in verify counts as a failed signature', async () => {
    await setup();
    W._resetDeliveryWebhookParsers();
    W.registerDeliveryWebhookParser('fake_courier', () => ({
      providerId: 'fake_courier',
      verify: () => {
        throw new Error('boom');
      },
      parse: () => null,
    }));
    expect((await POST(req('fake_courier', '{}', 'x'), ctx('fake_courier'))).status).toBe(401);
    expect(inbox.rows).toHaveLength(0);
  });

  it('a parser claiming another provider id is refused (not configured)', () => {
    W._resetDeliveryWebhookParsers();
    W.registerDeliveryWebhookParser('courier_a', () => ({ providerId: 'courier_b', verify: () => true, parse: () => null }));
    expect(W.resolveDeliveryWebhookParser('courier_a', {}).kind).toBe('not_configured');
  });
});

describe('D12 - a duplicate webhook is processed once', () => {
  it('the same event twice: 200 both times, one inbox row, one canonical event, one notice', async () => {
    const { shipment } = await setup();
    const body = JSON.stringify({ id: 'evt-assigned-1', ref: shipment.merchantReference, state: 'courier_assigned', at: '2026-10-20T06:40:00Z' });
    const first = await POST(req('fake_courier', body, sign(body)), ctx('fake_courier'));
    const eventsAfterFirst = repo.events.length;
    const outboxAfterFirst = repo.outbox.size;
    const second = await POST(req('fake_courier', body, sign(body)), ctx('fake_courier'));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(inbox.rows).toHaveLength(1);
    expect(inbox.rows[0].status).toBe('processed');
    expect(repo.events.filter((e) => e.to === 'courier_assigned')).toHaveLength(1);
    expect(repo.events.length).toBe(eventsAfterFirst);
    expect(repo.outbox.size).toBe(outboxAfterFirst);
    expect(repo.shipments.get(shipment.id)!.status).toBe('courier_assigned');
    // Notices from the applied event were sent straight away; the replay sent nothing new.
    expect(state.dispatched).toBe(1);
  });

  it('a replay arriving after a failed first processing is retried by the drain, still applied once', async () => {
    const { shipment, w } = await setup();
    repo.failNextTransitions = 1;
    const body = JSON.stringify({ id: 'evt-collected-1', ref: shipment.merchantReference, state: 'collected', at: '2026-10-20T07:05:00Z' });
    expect((await POST(req('fake_courier', body, sign(body)), ctx('fake_courier'))).status).toBe(200);
    expect(inbox.rows[0].status).toBe('failed');
    expect((await POST(req('fake_courier', body, sign(body)), ctx('fake_courier'))).status).toBe(200);
    expect(inbox.rows).toHaveLength(1);
    const { drainDeliveryInbox } = await import('@/lib/delivery/inbox');
    w.clock.advanceMinutes(5);
    inbox = state.inbox as InMemoryDeliveryInbox;
    await drainDeliveryInbox({ store: inbox, useCases: w.deps });
    await drainDeliveryInbox({ store: inbox, useCases: w.deps });
    expect(repo.events.filter((e) => e.to === 'collected')).toHaveLength(1);
    expect(repo.shipments.get(shipment.id)!.status).toBe('collected');
  });
});

describe('D13 - an out-of-order webhook cannot regress the leg', () => {
  it('"in transit" arriving after "delivered" is stored but changes nothing', async () => {
    const { shipment } = await setup();
    const delivered = JSON.stringify({ id: 'evt-d', ref: shipment.merchantReference, state: 'delivered', at: '2026-10-20T07:55:00Z' });
    const late = JSON.stringify({ id: 'evt-t', ref: shipment.merchantReference, state: 'in_transit', at: '2026-10-20T07:10:00Z' });
    expect((await POST(req('fake_courier', delivered, sign(delivered)), ctx('fake_courier'))).status).toBe(200);
    expect((await POST(req('fake_courier', late, sign(late)), ctx('fake_courier'))).status).toBe(200);
    expect(repo.shipments.get(shipment.id)!.status).toBe('delivered');
    expect(inbox.rows).toHaveLength(2);
    expect(inbox.rows[1]).toMatchObject({ status: 'ignored', outcome: 'stale' });
  });

  it('logs carry the provider and outcome only', async () => {
    const { shipment } = await setup();
    const body = JSON.stringify({ id: 'evt-x', ref: shipment.merchantReference, state: 'courier_assigned', at: '2026-10-20T06:40:00Z' });
    await POST(req('fake_courier', body, sign(body)), ctx('fake_courier'));
    expect(state.logs).toEqual([{ eventType: 'delivery_webhook', eventCategory: 'delivery', metadata: { provider: 'fake_courier', status: 200, outcome: 'applied' } }]);
  });
});

describe('parser registry API', () => {
  it('validates ids and refuses a second registration', () => {
    W._resetDeliveryWebhookParsers();
    expect(() => W.registerDeliveryWebhookParser('Bad Id', () => null)).toThrow();
    W.registerDeliveryWebhookParser('courier_x', () => null);
    expect(() => W.registerDeliveryWebhookParser('courier_x', () => null)).toThrow();
    expect(W.registeredDeliveryWebhookProviders()).toEqual(['courier_x']);
  });

  it('constantTimeEqual compares exactly', () => {
    expect(W.constantTimeEqual('abc', 'abc')).toBe(true);
    expect(W.constantTimeEqual('abc', 'abd')).toBe(false);
    expect(W.constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(W.constantTimeEqual('', '')).toBe(false);
  });
});
