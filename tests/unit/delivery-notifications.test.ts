/**
 * Delivery notifications (owner, 2026-10-14): the renter hears at every step
 * without opening the site.
 *  - Uber Direct's drop-off PIN is kept (089) and shown to the renter only.
 *  - One "on the way" email per outbound leg, whichever step comes first.
 *  - In-app delivery updates also go to the phone as push, once.
 *  - Our own SMS (BulkSMS) and WhatsApp templates are prepared, switched off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pushToUser = vi.fn();
vi.mock('@/lib/push/to-user', () => ({ pushToUser: (...a: unknown[]) => pushToUser(...a), PUSH_MAX_FAILURES: 3 }));
vi.mock('@/lib/push', async (orig) => ({ ...(await orig<typeof import('@/lib/push')>()), isPushConfigured: () => true }));

interface Call {
  table: string;
  op: string;
  args: unknown[];
}
const calls: Call[] = [];
let tables: Record<string, Record<string, unknown>[]> = {};

/** A tiny stand-in for the Supabase admin client: records writes, answers reads from `tables`. */
function fakeDb() {
  const chain = (table: string, rows: Record<string, unknown>[]) => {
    const q: Record<string, unknown> = {};
    const self = (): typeof q => q;
    for (const m of ['select', 'eq', 'overlaps', 'order', 'limit', 'in']) q[m] = (...args: unknown[]) => (calls.push({ table, op: m, args }), self());
    q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
    return q;
  };
  return {
    from(table: string) {
      return {
        select: (...args: unknown[]) => (calls.push({ table, op: 'select', args }), chain(table, tables[table] ?? [])),
        insert: (rows: Record<string, unknown>[]) => {
          calls.push({ table, op: 'insert', args: [rows] });
          const inserted = rows.map((r, i) => ({ id: `n${i + 1}`, user_id: r.user_id }));
          return { select: async () => ({ data: inserted, error: null }) };
        },
        update: (patch: Record<string, unknown>) => {
          calls.push({ table, op: 'update', args: [patch] });
          const u: Record<string, unknown> = {};
          u.eq = (...args: unknown[]) => (calls.push({ table, op: 'update.eq', args }), u);
          u.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res);
          return u;
        },
      };
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'renter@example.invalid' } } }) } },
  };
}
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => fakeDb(), createClient: async () => ({}) }));
const sendEmail = vi.fn(async () => undefined);
vi.mock('@/lib/email', () => ({ email: { sendEmail: (...a: unknown[]) => sendEmail(...(a as [])) } }));

const { NOTICE_CHANNELS, RENTAL_NOTICE_KINDS } = await import('@/lib/core/rental/notifications');
const { DELIVERY_PUSH_KINDS, onTheWayText, noticeData, supabaseNotify, rentalNoticeText } = await import('@/lib/rental/notify');
const { customerLegs } = await import('@/lib/delivery/customer-view');
const { DEFAULT_DELIVERY_POLICY } = await import('@/lib/core/delivery/policy');
const { commitDelivery, getDeliveryStatus, markDeliveryQuotesPaid, prepareDelivery, quoteDelivery, recordProviderEvent } = await import('@/lib/core/delivery/use-cases');
const { GROUP, LINES_FOR_QUOTE, OFFICE, OWNER_A, RENTER, RENTER_HOME, world } = await import('./helpers/delivery-fakes');
const { bulksms, BULKSMS_URL, sms } = await import('@/lib/sms');
const { DELIVERY_WHATSAPP_TEMPLATES } = await import('@/lib/whatsapp/delivery-templates');

const DASHES = /[–—]/;
const renter = { kind: 'renter' as const, userId: RENTER };

beforeEach(() => {
  calls.length = 0;
  tables = {};
  pushToUser.mockReset();
  sendEmail.mockClear();
});

/** A paid courier leg, dispatched; the fake courier makes PIN 6066 like Uber. */
async function dispatchedLeg() {
  const w = world({ courierEnabled: true, providers: 'courier', cover: { fake_courier: 2_000_000 } });
  w.deps.policy = { ...DEFAULT_DELIVERY_POLICY, automatedDeliveryMaxItemValueCents: 2_000_000 };
  w.courier.recipientPin = '6066';
  const q = await quoteDelivery(
    { caller: renter, renterId: RENTER, bookingGroupId: GROUP, leg: 'outbound', originAddressId: OFFICE, destinationAddressId: RENTER_HOME, lines: LINES_FOR_QUOTE, window: { start: '2026-10-20T07:00:00Z', end: '2026-10-20T09:00:00Z' } },
    w.deps,
  );
  if (!q.ok) throw new Error('quote');
  const p = await prepareDelivery({ caller: renter, quoteId: q.quotes[0].id, bookingGroupId: GROUP }, w.deps);
  if (!p.ok) throw new Error(p.code);
  await markDeliveryQuotesPaid({ paymentReference: 'pay-1', bookingGroupId: GROUP, renterId: RENTER, quoteIds: [q.quotes[0].id], paidDeliveryCents: q.quotes[0].customerFeeCents }, w.deps);
  expect(await commitDelivery({ caller: { kind: 'system' }, shipmentId: p.shipment.id }, w.deps)).toMatchObject({ ok: true, outcome: 'dispatched' });
  return { w, shipment: p.shipment };
}

describe('drop-off PIN', () => {
  it("is kept from the courier's answer and shown to the renter, never to an owner", async () => {
    const { w, shipment } = await dispatchedLeg();
    expect(w.repo.shipments.get(shipment.id)?.recipientPin).toBe('6066');
    const asRenter = await getDeliveryStatus({ caller: renter, bookingGroupId: GROUP }, w.deps);
    expect(asRenter.ok && asRenter.legs[0].recipientPin).toBe('6066');
    const asOwner = await getDeliveryStatus({ caller: { kind: 'owner', userId: OWNER_A }, bookingGroupId: GROUP }, w.deps);
    if (asOwner.ok) for (const l of asOwner.legs) expect(l.recipientPin ?? null).toBeNull();
  });

  it('shows on the booking page only while the gear is still coming', () => {
    const leg = (status: string, leg: 'outbound' | 'return' = 'outbound') =>
      customerLegs([{ shipmentId: 's1', leg, status: status as never, providerId: 'uber_direct', trackingUrl: null, courierName: null, recipientPin: '6066', scheduledAt: null, items: [] }], [])[0].pin;
    for (const s of ['scheduled', 'courier_assigned', 'collected', 'in_transit', 'courier_at_dropoff']) expect(leg(s)).toBe('6066');
    for (const s of ['delivered', 'cancelled', 'failed', 'delivery_attempt_failed']) expect(leg(s)).toBeNull();
    expect(leg('in_transit', 'return')).toBeNull();
  });
});

describe('one "on the way" email per outbound leg', () => {
  it('is queued at the first moving step, and the outbox keeps only one', async () => {
    const { w, shipment } = await dispatchedLeg();
    const evt = (state: 'courier_assigned' | 'collected' | 'in_transit', at: string) =>
      recordProviderEvent({ providerId: 'fake_courier', verified: true, dedupeKey: `wh:${state}`, merchantReference: shipment.merchantReference, providerReference: null, state, stateAt: at, source: 'provider_webhook' }, w.deps);
    await evt('courier_assigned', '2026-10-20T06:40:00Z');
    await evt('collected', '2026-10-20T07:05:00Z');
    await evt('in_transit', '2026-10-20T07:10:00Z');
    const onTheWay = [...w.repo.outbox.values()].filter((m) => m.kind === 'delivery_on_the_way');
    expect(onTheWay).toHaveLength(1);
    expect(onTheWay[0]).toMatchObject({ channel: 'email', userId: RENTER });
    // The queued row carries no address; it is read when the email is sent.
    expect(JSON.stringify(onTheWay[0].data)).not.toMatch(/street|road|avenue/i);
  });

  it('a courier that skips "collected" still sends it (Uber went assigned, then on the way)', async () => {
    const { w, shipment } = await dispatchedLeg();
    await recordProviderEvent({ providerId: 'fake_courier', verified: true, dedupeKey: 'wh:t', merchantReference: shipment.merchantReference, providerReference: null, state: 'in_transit', stateAt: '2026-10-20T07:10:00Z', source: 'provider_webhook' }, w.deps);
    expect([...w.repo.outbox.values()].filter((m) => m.kind === 'delivery_on_the_way')).toHaveLength(1);
  });

  it('is email only; delivered keeps email (and SMS when switched on)', () => {
    expect(NOTICE_CHANNELS.delivery_on_the_way).toEqual(['email']);
    expect(NOTICE_CHANNELS.delivery_delivered).toEqual(expect.arrayContaining(['in_app', 'email']));
  });

  it('says who, where, the PIN, the live link and who to contact, in plain words', () => {
    const t = onTheWayText({ driverName: 'Sipho', address: '50 Bath Avenue, Rosebank', pin: '6066', pinTexted: true, trackingUrl: 'https://direct-order.uber.com/za/orders/x' });
    expect(t.title).toBe('Your gear is on the way');
    for (const part of ['Sipho', '50 Bath Avenue, Rosebank', '6066', 'Uber also sends it to you by SMS', 'https://direct-order.uber.com/za/orders/x', 'ID', 'WhatsApp']) expect(t.body).toContain(part);
    expect(`${t.title} ${t.body}`).not.toMatch(DASHES);
    const bare = onTheWayText({});
    expect(bare.body).toContain('the address you gave at checkout');
    expect(bare.body).not.toContain('PIN');
    expect(bare.body).not.toContain('undefined');
  });

  it("reads the facts when it is sent; no tracking link on a leg from an owner's address; never a redacted address", async () => {
    tables.delivery_shipments = [{ provider: 'uber_direct', tracking_url: 'https://direct-order.uber.com/za/orders/x', courier_name: 'Sipho', recipient_pin: '6066', destination_address_id: 'a1', origin_owner_id: null }];
    tables.delivery_addresses = [{ formatted_address: '50 Bath Avenue, Rosebank', redacted_at: null }];
    const m = { kind: 'delivery_on_the_way' as const, bookingIds: ['bk-1'], data: {} };
    expect(await noticeData(fakeDb() as never, m)).toMatchObject({ driverName: 'Sipho', address: '50 Bath Avenue, Rosebank', pin: '6066', pinTexted: true, trackingUrl: 'https://direct-order.uber.com/za/orders/x' });
    tables.delivery_shipments[0].origin_owner_id = 'owner-1';
    tables.delivery_addresses[0].redacted_at = '2026-10-20T00:00:00Z';
    expect(await noticeData(fakeDb() as never, m)).toMatchObject({ trackingUrl: null, address: null });
    // Only outbound legs, matched by booking.
    expect(calls).toEqual(expect.arrayContaining([expect.objectContaining({ table: 'delivery_shipments', op: 'eq', args: ['leg', 'outbound'] }), expect.objectContaining({ op: 'overlaps', args: ['booking_ids', ['bk-1']] })]));
  });

  it('every delivery notice has words, without dashes', () => {
    for (const k of RENTAL_NOTICE_KINDS.filter((x) => x.startsWith('delivery_'))) {
      const t = rentalNoticeText(k, { amountCents: 1000 });
      expect(`${t.title} ${t.body}`).not.toMatch(DASHES);
    }
  });
});

describe('phone push for delivery updates', () => {
  it('pushes picked up, on the way, delivered and failed; every one is also an in-app notice', () => {
    for (const k of ['delivery_courier_assigned', 'delivery_collected', 'delivery_in_transit', 'delivery_delivered', 'delivery_attempt_failed'] as const) expect(DELIVERY_PUSH_KINDS.has(k)).toBe(true);
    for (const k of DELIVERY_PUSH_KINDS) expect(NOTICE_CHANNELS[k]).toContain('in_app');
    expect(DELIVERY_PUSH_KINDS.has('payment_received' as never)).toBe(false);
  });

  it('a delivery update goes to the phone at once, linked to the booking, and the bell push is marked sent', async () => {
    pushToUser.mockResolvedValue({ sent: 1, gone: 0 });
    const r = await supabaseNotify.deliver({ dedupeKey: 'k', kind: 'delivery_in_transit', channel: 'in_app', userId: RENTER, bookingIds: ['bk-1'], data: {}, sendAfter: null });
    expect(r).toEqual({ ok: true });
    expect(pushToUser).toHaveBeenCalledTimes(1);
    const [, userId, payload] = pushToUser.mock.calls[0] as [unknown, string, { url: string; tag: string; title: string }];
    expect(userId).toBe(RENTER);
    expect(payload).toMatchObject({ url: '/dashboard/bookings/bk-1', tag: 'delivery-bk-1', title: 'Gear on the way' });
    expect(calls).toEqual(expect.arrayContaining([expect.objectContaining({ table: 'notification_outbox', op: 'update.eq', args: ['dedupe_key', 'engage_push:notification:n1'] })]));
  });

  it('no push when nothing was sent, for other notices, or for staff; a push failure never fails the notice', async () => {
    pushToUser.mockResolvedValue({ sent: 0, gone: 0 });
    await supabaseNotify.deliver({ dedupeKey: 'k', kind: 'delivery_delivered', channel: 'in_app', userId: RENTER, bookingIds: ['bk-1'], data: {}, sendAfter: null });
    expect(calls.some((c) => c.table === 'notification_outbox')).toBe(false);
    pushToUser.mockClear();
    await supabaseNotify.deliver({ dedupeKey: 'k2', kind: 'payment_received', channel: 'in_app', userId: RENTER, bookingIds: ['bk-1'], data: {}, sendAfter: null });
    expect(pushToUser).not.toHaveBeenCalled();
    pushToUser.mockRejectedValue(new Error('push service down'));
    expect(await supabaseNotify.deliver({ dedupeKey: 'k3', kind: 'delivery_collected', channel: 'in_app', userId: RENTER, bookingIds: ['bk-1'], data: {}, sendAfter: null })).toEqual({ ok: true });
  });
});

describe('our own SMS and WhatsApp: prepared, switched off', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  it('BulkSMS is not the default and is off without its token', () => {
    expect(sms.name).not.toBe('bulksms');
    delete process.env.BULKSMS_TOKEN_ID;
    delete process.env.BULKSMS_TOKEN_SECRET;
    expect(bulksms.isConfigured()).toBe(false);
  });

  it('BulkSMS sends one message to an international number only', async () => {
    process.env.BULKSMS_TOKEN_ID = 'id';
    process.env.BULKSMS_TOKEN_SECRET = 'secret';
    const fetchMock = vi.fn(async () => new Response('[]', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await bulksms.send('0639905802', 'x')).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await bulksms.send('+27639905802', 'Your gear is on the way')).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(BULKSMS_URL);
    expect(JSON.parse(String(init.body))).toEqual([{ to: '+27639905802', body: 'Your gear is on the way' }]);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`);
  });

  it('WhatsApp templates: unique names, one value per placeholder, real notice kinds, plain words', () => {
    const names = DELIVERY_WHATSAPP_TEMPLATES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of DELIVERY_WHATSAPP_TEMPLATES) {
      expect(t.name).toMatch(/^[a-z0-9_]+$/);
      expect(RENTAL_NOTICE_KINDS).toContain(t.kind);
      const placeholders = t.body.match(/\{\{\d+\}\}/g) ?? [];
      expect(placeholders).toEqual(t.params.map((_, i) => `{{${i + 1}}}`));
      expect(t.body).not.toMatch(DASHES);
      expect(t.body.length).toBeLessThan(1024);
    }
  });
});
