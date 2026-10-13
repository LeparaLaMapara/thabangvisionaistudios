/**
 * fix/paystack-money-flows (2026-10-13): a creator booking is confirmed on the
 * return page by asking Paystack, not only by the webhook; the daily job asks
 * Paystack before closing an unpaid booking; references keep to the
 * characters Paystack allows; the bookings page explains what happened.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callbackStatus,
  classifyCharge,
  referenceFromCallback,
  sortUnpaidServiceBookings,
  verifyAndConfirmServiceBooking,
  webhookFromCharge,
  type ServicePaymentOutcome,
} from '@/lib/payments/service-payment-check';
import { crewPaymentReference, crewRequestIdFromReference } from '@/lib/payments/crew-reference';
import { newServiceBookingReference } from '@/lib/payments/booking-reference';
import { canPayAgain, servicePaymentNotice } from '@/lib/bookings/service-payment-notice';

const ok = (status: string) => ({ ok: true as const, value: { status, amountCents: 150000, currency: 'ZAR', providerTransactionId: '987' } });

describe('classifyCharge', () => {
  it('success is paid, with the amount in cents and the Paystack id', () => {
    expect(classifyCharge(ok('success'))).toEqual({ state: 'paid', providerTransactionId: '987', amountCents: 150000, currency: 'ZAR' });
  });
  it.each(['failed', 'abandoned', 'reversed'])('%s is definitely not paid', (s) => {
    expect(classifyCharge(ok(s)).state).toBe('not_paid');
  });
  it.each(['ongoing', 'pending', 'processing', 'queued', ''])('"%s" is still pending', (s) => {
    expect(classifyCharge(ok(s)).state).toBe('pending');
  });
  it('"Transaction reference not found" means no payment was ever started', () => {
    expect(classifyCharge({ ok: false, kind: 'rejected', message: 'Transaction reference not found' })).toEqual({ state: 'not_paid', reason: 'not_found' });
  });
  it('any other refusal, a timeout or a 5xx proves nothing', () => {
    expect(classifyCharge({ ok: false, kind: 'rejected', message: 'Invalid key' }).state).toBe('unreachable');
    expect(classifyCharge({ ok: false, kind: 'unknown', message: 'timeout' }).state).toBe('unreachable');
  });
});

describe('verifyAndConfirmServiceBooking', () => {
  it('confirms a paid booking through the same confirmation as the webhook', async () => {
    const confirm = vi.fn(async () => 'confirmed' as const);
    const out = await verifyAndConfirmServiceBooking('BK-abc123XYZ0', {
      check: async () => classifyCharge(ok('success')),
      confirm,
    });
    expect(out).toEqual({ state: 'paid', confirmation: 'confirmed' });
    expect(confirm).toHaveBeenCalledTimes(1);
    const w = (confirm.mock.calls[0] as unknown as [ReturnType<typeof webhookFromCharge>])[0];
    expect(w).toMatchObject({ valid: true, status: 'COMPLETE', paymentId: 'BK-abc123XYZ0', providerPaymentId: '987', amountGross: 1500 });
    expect(w.raw).toMatchObject({ currency: 'ZAR', custom_str1: 'service_booking' });
  });
  it('never confirms when Paystack does not say success', async () => {
    const confirm = vi.fn(async () => 'confirmed' as const);
    for (const s of ['failed', 'abandoned', 'ongoing']) {
      const out = await verifyAndConfirmServiceBooking('BK-1', { check: async () => classifyCharge(ok(s)), confirm });
      expect(out.state).not.toBe('paid');
    }
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('callbackStatus', () => {
  it.each<[ServicePaymentOutcome, string]>([
    [{ state: 'paid', confirmation: 'confirmed' }, 'success'],
    [{ state: 'paid', confirmation: 'already_paid' }, 'success'],
    [{ state: 'paid', confirmation: 'rejected' }, 'held'],
    [{ state: 'paid', confirmation: 'not_awaiting_payment' }, 'held'],
    [{ state: 'not_paid', reason: 'failed' }, 'failed'],
    [{ state: 'pending', status: 'ongoing' }, 'pending'],
    [{ state: 'unreachable', message: 'x' }, 'error'],
  ])('%j -> %s', (outcome, status) => {
    expect(callbackStatus(outcome)).toBe(status);
  });
});

describe('referenceFromCallback', () => {
  it('reads our reference, or the trxref Paystack adds', () => {
    expect(referenceFromCallback(new URLSearchParams('reference=BK-abc&trxref=BK-abc'))).toBe('BK-abc');
    expect(referenceFromCallback(new URLSearchParams('trxref=BK-abc'))).toBe('BK-abc');
  });
  it('drops a second query string glued onto ours', () => {
    expect(referenceFromCallback(new URLSearchParams('reference=BK-abc?trxref=BK-abc'))).toBe('BK-abc');
  });
  it('refuses anything that is not a Paystack reference', () => {
    expect(referenceFromCallback(new URLSearchParams('reference=<script>'))).toBeNull();
    expect(referenceFromCallback(new URLSearchParams(''))).toBeNull();
  });
});

describe('sortUnpaidServiceBookings (daily job)', () => {
  const rows = ['paid', 'gone', 'busy', 'down', 'boom'].map((r) => ({ id: `id-${r}`, reference: r }));
  const verify = async (ref: string): Promise<ServicePaymentOutcome> => {
    if (ref === 'paid') return { state: 'paid', confirmation: 'confirmed' };
    if (ref === 'gone') return { state: 'not_paid', reason: 'abandoned' };
    if (ref === 'busy') return { state: 'pending', status: 'ongoing' };
    if (ref === 'down') return { state: 'unreachable', message: 'timeout' };
    throw new Error('db down');
  };
  it('cancels only what Paystack says is not paid; confirms the paid one; skips the rest', async () => {
    const { cancel, outcomes } = await sortUnpaidServiceBookings(rows, verify, { providerAvailable: true });
    expect(cancel).toEqual(['id-gone']);
    expect(outcomes).toEqual({ paid_confirmed: 1, not_paid: 1, pending: 1, unreachable: 1, confirm_error: 1 });
  });
  it('with no Paystack key at all, no Paystack payment can exist: cancels as before', async () => {
    const v = vi.fn(verify);
    const { cancel } = await sortUnpaidServiceBookings(rows, v, { providerAvailable: false });
    expect(cancel).toHaveLength(5);
    expect(v).not.toHaveBeenCalled();
  });
});

describe('payment references', () => {
  it('service booking references keep to the characters Paystack documents (no "_")', () => {
    for (let i = 0; i < 2000; i++) expect(newServiceBookingReference()).toMatch(/^BK-[A-Za-z0-9]{10}$/);
  });
  it('crew references are unique per attempt and lead back to the request', () => {
    const id = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
    const a = crewPaymentReference(id, 'full', new Date(1_000));
    const b = crewPaymentReference(id, 'deposit', new Date(2_000));
    expect(a).not.toBe(b);
    for (const r of [a, b]) {
      expect(r).toMatch(/^[A-Za-z0-9.=-]+$/);
      expect(crewRequestIdFromReference(r)).toBe(id);
    }
    expect(crewRequestIdFromReference(id)).toBe(id);
    expect(crewRequestIdFromReference('BK-abc')).toBeNull();
  });
});

describe('bookings page notice and pay again', () => {
  it('explains each return status, and nothing without one', () => {
    expect(servicePaymentNotice('success', 'BK-1')?.tone).toBe('good');
    expect(servicePaymentNotice('failed', 'BK-1')?.body).toMatch(/Pay again/);
    expect(servicePaymentNotice('cancelled', null)?.body).toMatch(/Pay again/);
    expect(servicePaymentNotice('error', 'BK-1')?.tone).toBe('bad');
    expect(servicePaymentNotice('held', 'BK-1')?.body).toMatch(/do not pay again/);
    expect(servicePaymentNotice(null, null)).toBeNull();
    expect(servicePaymentNotice('failed', '<b>x</b>')?.body).not.toContain('<b>');
  });
  it('offers pay again only for an unpaid pending booking while payments are open', () => {
    expect(canPayAgain({ status: 'pending', payment_status: 'unpaid' }, true)).toBe(true);
    expect(canPayAgain({ status: 'pending', payment_status: 'unpaid' }, false)).toBe(false);
    expect(canPayAgain({ status: 'pending', payment_status: 'unpaid' }, null)).toBe(false);
    expect(canPayAgain({ status: 'paid', payment_status: 'paid' }, true)).toBe(false);
    expect(canPayAgain({ status: 'cancelled', payment_status: 'unpaid' }, true)).toBe(false);
  });
});

// ─── The return page itself ──────────────────────────────────────────────────

const verifyCharge = vi.fn();
const confirmServiceBookingPayment = vi.fn();
vi.mock('@/lib/payments/paystack-ports', () => ({ paystackPayments: { verifyCharge: (r: string) => verifyCharge(r) } }));
vi.mock('@/lib/payments/fulfil', () => ({ confirmServiceBookingPayment: (w: unknown) => confirmServiceBookingPayment(w) }));
vi.mock('@/lib/auth', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/data/events', () => ({ logEvent: () => undefined }));

describe('GET /api/service-bookings/callback', () => {
  beforeEach(() => {
    verifyCharge.mockReset();
    confirmServiceBookingPayment.mockReset();
  });
  const call = async (qs: string) => {
    const { GET } = await import('@/app/api/service-bookings/callback/route');
    const { NextRequest } = await import('next/server');
    const res = await GET(new NextRequest(`https://example.com/api/service-bookings/callback?${qs}`));
    return new URL(res.headers.get('location') ?? '');
  };

  it('confirms a paid booking with no webhook at all, then says success', async () => {
    verifyCharge.mockResolvedValue(ok('success'));
    confirmServiceBookingPayment.mockResolvedValue('confirmed');
    const to = await call('reference=BK-abc&trxref=BK-abc');
    expect(verifyCharge).toHaveBeenCalledWith('BK-abc');
    expect(confirmServiceBookingPayment).toHaveBeenCalledTimes(1);
    expect(to.pathname).toBe('/dashboard/bookings');
    expect(to.searchParams.get('status')).toBe('success');
    expect(to.searchParams.get('ref')).toBe('BK-abc');
  });
  it('a declined card goes back with status=failed and confirms nothing', async () => {
    verifyCharge.mockResolvedValue(ok('failed'));
    const to = await call('reference=BK-abc');
    expect(confirmServiceBookingPayment).not.toHaveBeenCalled();
    expect(to.searchParams.get('status')).toBe('failed');
  });
  it('Paystack unreachable is an error, not a failure', async () => {
    verifyCharge.mockResolvedValue({ ok: false, kind: 'unknown', message: 'timeout' });
    expect((await call('reference=BK-abc')).searchParams.get('status')).toBe('error');
  });
  it('a database error while confirming is an error, never success', async () => {
    verifyCharge.mockResolvedValue(ok('success'));
    confirmServiceBookingPayment.mockRejectedValue(new Error('db down'));
    expect((await call('reference=BK-abc')).searchParams.get('status')).toBe('error');
  });
  it('no reference: error, and Paystack is not asked', async () => {
    expect((await call('')).searchParams.get('status')).toBe('error');
    expect(verifyCharge).not.toHaveBeenCalled();
  });
});
