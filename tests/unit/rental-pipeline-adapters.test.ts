import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { parsePaystackEvent } from '@/lib/rental/inbox';
import { checkoutGroupIdFor, snapshotLines } from '@/lib/rental/reserve';
import { rentalNoticeText } from '@/lib/rental/notify';
import { RENTAL_NOTICE_KINDS } from '@/lib/core/rental/notifications';
import {
  detectConfirmedWithoutPayment,
  detectInboxProblems,
  detectIntentProblems,
  detectInventoryConflicts,
  detectPayoutProblems,
  detectRefundProblems,
} from '@/lib/core/rental/reconcile';
import { effectiveEndDate, isExpiredHold, overlapsRange } from '@/lib/rental/availability';

const NOW = new Date('2026-10-08T10:00:00.000Z');

describe('payment inbox: parsing and data minimisation', () => {
  const charge = JSON.stringify({
    event: 'charge.success',
    data: {
      id: 4099260516,
      reference: '0f7c1d2e-1111-4222-8333-444455556666',
      amount: 700000,
      currency: 'ZAR',
      status: 'success',
      customer: { email: 'someone@example.com', phone: '+27820000000' },
      authorization: { last4: '4081', bin: '408408', bank: 'TEST BANK' },
      metadata: { customStr1: 'cart_checkout', customStr2: 'user-1', item_name: 'x' },
    },
  });

  it('extracts what the processor needs', () => {
    const p = parsePaystackEvent(charge)!;
    expect(p).toMatchObject({ event: 'charge.success', dataId: '4099260516', amountCents: 700000, currency: 'ZAR', metadataUserId: 'user-1', paymentType: 'cart_checkout' });
  });

  it('keeps no customer, card or bank details in the stored copy', () => {
    const stored = JSON.stringify(parsePaystackEvent(charge)!.minimal);
    expect(stored).not.toContain('someone@example.com');
    expect(stored).not.toContain('+27820000000');
    expect(stored).not.toContain('4081');
    expect(stored).not.toContain('TEST BANK');
    expect(stored).not.toContain('item_name');
  });

  it('finds the charge behind a refund event, in either shape', () => {
    const a = parsePaystackEvent(JSON.stringify({ event: 'refund.processed', data: { id: 77, status: 'processed', amount: 250000, transaction_reference: 'tx-ref' } }))!;
    expect(a.transactionReference).toBe('tx-ref');
    const b = parsePaystackEvent(JSON.stringify({ event: 'refund.processed', data: { id: 78, status: 'processed', amount: 1, transaction: { id: 9, reference: 'tx-2' } } }))!;
    expect(b.transactionReference).toBe('tx-2');
    // re-parsing the stored minimal copy gives the same answer (inbox retries use it)
    const again = parsePaystackEvent(JSON.stringify(b.minimal))!;
    expect(again).toMatchObject({ event: 'refund.processed', dataId: '78', transactionReference: 'tx-2', amountCents: 1 });
  });

  it('rejects garbage', () => {
    expect(parsePaystackEvent('not json')).toBeNull();
    expect(parsePaystackEvent(JSON.stringify({ data: {} }))).toBeNull();
  });
});

describe('checkout: idempotent order ids and money snapshots', () => {
  it('T06: the same customer + key always maps to the same order id; different keys or customers do not', () => {
    const a = checkoutGroupIdFor('user-1', 'key-abcdef12');
    expect(checkoutGroupIdFor('user-1', 'key-abcdef12')).toBe(a);
    expect(checkoutGroupIdFor('user-1', 'key-abcdef13')).not.toBe(a);
    expect(checkoutGroupIdFor('user-2', 'key-abcdef12')).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // no or malformed key → random
    expect(checkoutGroupIdFor('user-1', null)).not.toBe(checkoutGroupIdFor('user-1', null));
    expect(checkoutGroupIdFor('user-1', 'bad key!')).not.toBe(checkoutGroupIdFor('user-1', 'bad key!'));
  });

  it('T03/T04: spreads the order discount exactly and splits community gear 80/20 without the deposit', () => {
    const lines = snapshotLines(
      [
        { rentalId: 'a', quantity: 1, subtotalRands: 4500, depositRands: 2500, unitReplacementValueRands: 10000, ownerType: 'community', ownerId: 'owner-1' },
        { rentalId: 'b', quantity: 2, subtotalRands: 1000.01, depositRands: 500, unitReplacementValueRands: 2000, ownerType: 'studio', ownerId: null },
        { rentalId: 'c', quantity: 1, subtotalRands: 333.33, depositRands: 0, unitReplacementValueRands: 1000, ownerType: 'community', ownerId: null },
      ],
      583.33,
    );
    const net = 450000 + 100001 + 33333 - 58333;
    expect(lines.reduce((s, l) => s + l.hire_cents, 0)).toBe(net);
    expect(lines[0]).toMatchObject({ ownership: 'community', owner_id: 'owner-1', deposit_cents: 250000, unit_replacement_value_cents: 1000000 });
    expect((lines[0].owner_share_cents ?? 0) + (lines[0].platform_share_cents ?? 0)).toBe(lines[0].hire_cents);
    expect(lines[1]).toMatchObject({ ownership: 'studio', owner_share_cents: null, platform_share_cents: null });
    // community listing without an owner id is treated as studio (nobody to pay)
    expect(lines[2]).toMatchObject({ ownership: 'studio', owner_id: null });
  });

  it('worked example: R4,500 hire → owner R3,600, platform R900', () => {
    const [l] = snapshotLines([{ rentalId: 'a', quantity: 1, subtotalRands: 4500, depositRands: 2500, unitReplacementValueRands: 10000, ownerType: 'community', ownerId: 'o' }], 0);
    expect(l).toMatchObject({ hire_cents: 450000, owner_share_cents: 360000, platform_share_cents: 90000 });
  });
});

describe('notifications wording', () => {
  it('has wording for every kind, and never claims a refund before the provider confirms it', () => {
    for (const kind of RENTAL_NOTICE_KINDS) {
      const t = rentalNoticeText(kind, { amountCents: 250000 });
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.body.length).toBeGreaterThan(10);
    }
    expect(rentalNoticeText('refund_initiated', { amountCents: 250000 }).body).toMatch(/not complete yet/);
    expect(rentalNoticeText('refund_initiated', { amountCents: 250000 }).title).not.toMatch(/refunded/i);
    expect(rentalNoticeText('refund_processed', { amountCents: 250000 }).body).toContain('2 500');
  });

  it('overdue notices never accuse anyone', () => {
    const t = rentalNoticeText('overdue_reminder', {});
    expect(`${t.title} ${t.body}`).not.toMatch(/thie|stol|police|SAPS|criminal/i);
  });
});

describe('availability dates (same rules as rental_units_blocked)', () => {
  it('the return day is not resold; gear not back blocks open-endedly', () => {
    const today = '2026-10-08';
    expect(overlapsRange({ status: 'confirmed', start_date: '2026-10-10', end_date: '2026-10-13' }, '2026-10-13', '2026-10-15', today)).toBe(true);
    expect(overlapsRange({ status: 'confirmed', start_date: '2026-10-10', end_date: '2026-10-13' }, '2026-10-14', '2026-10-15', today)).toBe(false);
    expect(effectiveEndDate({ status: 'overdue', end_date: '2026-10-01' }, today)).toBeNull();
    expect(effectiveEndDate({ status: 'disputed', end_date: '2026-10-01' }, today)).toBeNull();
    expect(effectiveEndDate({ status: 'active', end_date: '2026-10-07' }, today)).toBeNull();
    expect(effectiveEndDate({ status: 'active', end_date: '2026-10-09' }, today)).toBe('2026-10-09');
    expect(overlapsRange({ status: 'overdue', start_date: '2026-10-01', end_date: '2026-10-03' }, '2027-01-01', '2027-01-02', today)).toBe(true);
  });

  it('an explicit hold expiry decides, not the creation time', () => {
    const base = { id: 'x', quantity: 1, status: 'pending', createdAt: '2026-10-08T09:59:00Z', paymentReference: null };
    expect(isExpiredHold({ ...base, holdExpiresAt: '2026-10-08T09:59:30Z' }, NOW)).toBe(true);
    expect(isExpiredHold({ ...base, createdAt: '2026-10-01T00:00:00Z', holdExpiresAt: '2026-10-09T00:00:00Z' }, NOW)).toBe(false);
  });
});

describe('reconciliation detectors (stay quiet on healthy data)', () => {
  it('payment received but not confirmed, and money owed back', () => {
    const rows = [
      { reference: 'ok', state: 'paid', paidAt: '2026-10-08T09:00:00Z', updatedAt: '2026-10-08T09:00:00Z', lineStatuses: ['confirmed'] },
      { reference: 'fresh', state: 'paid', paidAt: '2026-10-08T09:55:00Z', updatedAt: '2026-10-08T09:55:00Z', lineStatuses: ['pending'] },
      { reference: 'stuck', state: 'paid', paidAt: '2026-10-08T09:00:00Z', updatedAt: '2026-10-08T09:00:00Z', lineStatuses: ['pending'] },
      { reference: 'owed', state: 'refund_due', paidAt: null, updatedAt: '2026-10-08T05:00:00Z', lineStatuses: ['cancelled'] },
    ];
    expect(detectIntentProblems(rows, NOW).map((f) => [f.checkId, f.entityId])).toEqual([
      ['rental-paid-not-confirmed', 'stuck'],
      ['rental-unallocated-money', 'owed'],
    ]);
  });

  it('confirmed without payment ignores manual and counter payments', () => {
    expect(detectConfirmedWithoutPayment([
      { id: 'a', status: 'confirmed', paymentMethod: 'online', paymentReference: '123' },
      { id: 'b', status: 'confirmed', paymentMethod: 'eft', paymentReference: null },
      { id: 'c', status: 'confirmed', paymentMethod: 'online', paymentReference: null },
      { id: 'd', status: 'pending', paymentMethod: 'online', paymentReference: null },
    ]).map((f) => f.entityId)).toEqual(['c']);
  });

  it('T15: failed refunds alert; in-flight refunds alert only when stuck', () => {
    const f = detectRefundProblems([
      { id: '1', state: 'failed', updatedAt: '2026-10-08T09:00:00Z' },
      { id: '2', state: 'pending', updatedAt: '2026-10-08T09:00:00Z' },
      { id: '3', state: 'pending', updatedAt: '2026-10-01T09:00:00Z' },
      { id: '4', state: 'eligible', updatedAt: '2026-10-01T09:00:00Z' },
    ], NOW);
    expect(f.map((x) => [x.checkId, x.entityId])).toEqual([['rental-refund-failed', '1'], ['rental-refund-stuck', '3']]);
  });

  it('payout, inbox and inventory problems', () => {
    expect(detectPayoutProblems([{ id: 'p', state: 'reversed', updatedAt: '2026-10-08T09:00:00Z' }, { id: 'q', state: 'scheduled', updatedAt: '2026-01-01T00:00:00Z' }], NOW).map((x) => x.entityId)).toEqual(['p']);
    expect(detectInboxProblems([{ id: 'e', status: 'received', receivedAt: '2026-10-08T09:55:00Z' }], NOW)).toEqual([]);
    expect(detectInboxProblems([{ id: 'e', status: 'dead', receivedAt: '2026-10-08T09:55:00Z' }, { id: 'f', status: 'failed', receivedAt: '2026-10-08T07:00:00Z' }], NOW).map((x) => x.checkId)).toEqual(['payment-inbox-dead', 'payment-inbox-backlog']);
    expect(detectInventoryConflicts([{ rentalId: 'r', stock: 1, peakHeld: 1 }, { rentalId: 's', stock: 1, peakHeld: 2 }]).map((x) => x.entityId)).toEqual(['s']);
  });
});

// ── Webhook route: never acknowledge before storing (spec §7.6) ─────────────

const mocks = vi.hoisted(() => ({
  valid: true,
  configured: true,
  store: vi.fn(),
  processStored: vi.fn(),
  processDirect: vi.fn(),
}));

vi.mock('@/lib/payments/paystack', () => ({
  paystack: {
    isConfigured: () => mocks.configured,
    validateWebhook: async () => ({ valid: mocks.valid, status: 'COMPLETE', providerPaymentId: '1', paymentId: 'r', amountGross: 1, raw: {} }),
  },
}));
vi.mock('@/lib/data/events', () => ({ logEvent: vi.fn() }));
vi.mock('@/lib/rental/notify', async (orig) => {
  const real = await orig<typeof import('@/lib/rental/notify')>();
  return { ...real, dispatchOutbox: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0 })) };
});
vi.mock('@/lib/rental/inbox', async (orig) => {
  const real = await orig<typeof import('@/lib/rental/inbox')>();
  return { ...real, storeEvent: mocks.store, processStoredEvent: mocks.processStored, processPaystackEvent: mocks.processDirect };
});

describe('Paystack webhook route', () => {
  const body = JSON.stringify({ event: 'charge.success', data: { id: 1, reference: 'r', amount: 100, currency: 'ZAR', status: 'success' } });
  const req = () => new NextRequest('http://localhost/api/webhooks/paystack', { method: 'POST', body, headers: { 'x-paystack-signature': 'sig' } });

  beforeEach(() => {
    mocks.valid = true;
    mocks.configured = true;
    mocks.store.mockReset();
    mocks.processStored.mockReset();
    mocks.processDirect.mockReset();
  });

  it('T10: an invalid signature is rejected and nothing is stored', async () => {
    mocks.valid = false;
    const { POST } = await import('@/app/api/webhooks/paystack/route');
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it('answers 500 (so Paystack retries) when the event cannot be stored', async () => {
    mocks.store.mockRejectedValue(new Error('db down'));
    const { POST } = await import('@/app/api/webhooks/paystack/route');
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(mocks.processStored).not.toHaveBeenCalled();
  });

  it('stores, then processes, then acknowledges', async () => {
    mocks.store.mockResolvedValue({ stored: true, id: 'evt-1' });
    mocks.processStored.mockResolvedValue('confirmed');
    const { POST } = await import('@/app/api/webhooks/paystack/route');
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(mocks.processStored).toHaveBeenCalledWith('evt-1', expect.objectContaining({ event: 'charge.success' }));
  });

  it('T09: a redelivered event is acknowledged without processing it again', async () => {
    mocks.store.mockResolvedValue({ stored: false, duplicate: true });
    const { POST } = await import('@/app/api/webhooks/paystack/route');
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(mocks.processStored).not.toHaveBeenCalled();
    expect(mocks.processDirect).not.toHaveBeenCalled();
  });

  it('a processing failure after storing is still acknowledged (the pipeline retries it)', async () => {
    mocks.store.mockResolvedValue({ stored: true, id: 'evt-2' });
    mocks.processStored.mockResolvedValue('failed');
    const { POST } = await import('@/app/api/webhooks/paystack/route');
    expect((await POST(req())).status).toBe(200);
  });

  it('without migration 070 it processes directly, and fails loudly if that fails', async () => {
    mocks.store.mockResolvedValue({ stored: false, missingPipeline: true });
    mocks.processDirect.mockRejectedValue(new Error('boom'));
    const { POST } = await import('@/app/api/webhooks/paystack/route');
    expect((await POST(req())).status).toBe(500);
  });
});
