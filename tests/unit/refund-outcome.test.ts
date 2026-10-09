import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderCallResult, ProviderRefund } from '@/lib/core/ports';

// refundWithOutcome tells "the provider refused" apart from "we do not know".
// The legacy refundPayment folded a timeout, a network error and a 5xx into
// success:false, which the service routes recorded as 'failed' and staff were
// told to refund by hand: if the provider had in fact refunded, the client was
// refunded twice.

const paystackRefund = vi.fn<(p: { transactionReference: string; amountCents: number; idempotencyKey: string }) => Promise<ProviderCallResult<ProviderRefund>>>();
const yocoRefund = vi.fn<(ref: string, amount?: number) => Promise<{ success: boolean; error?: string }>>();

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/payments/paystack-ports', () => ({ paystackPayments: { refund: paystackRefund } }));
vi.mock('@/lib/payments/paystack', () => ({ paystack: {}, verifyPayment: vi.fn() }));
vi.mock('@/lib/payments/yoco', () => ({ yoco: { refund: yocoRefund }, isYocoReference: (r: string) => r.startsWith('ch_') }));

const { refundWithOutcome } = await import('@/lib/payments/routing');

const KEY = 'service-cancel:b-1';

beforeEach(() => {
  paystackRefund.mockReset();
  yocoRefund.mockReset();
});

describe('refundWithOutcome', () => {
  it('sends whole rands to Paystack as integer cents, with the idempotency key', async () => {
    paystackRefund.mockResolvedValueOnce({ ok: true, value: { providerRefundId: '123', status: 'pending', amountCents: 150_050 } });
    const r = await refundWithOutcome({ reference: 'BK-1', amountRands: 1500.5, idempotencyKey: KEY });
    expect(r).toEqual({ outcome: 'refunded', providerRefundId: '123' });
    expect(paystackRefund).toHaveBeenCalledWith({ transactionReference: 'BK-1', amountCents: 150_050, idempotencyKey: KEY });
  });

  it('a 4xx refusal is rejected (nothing moved); a timeout or 5xx is unknown', async () => {
    paystackRefund.mockResolvedValueOnce({ ok: false, kind: 'rejected', message: 'Transaction has been fully reversed' });
    expect(await refundWithOutcome({ reference: 'BK-1', amountRands: 100, idempotencyKey: KEY })).toEqual({ outcome: 'rejected', message: 'Transaction has been fully reversed' });
    paystackRefund.mockResolvedValueOnce({ ok: false, kind: 'unknown', message: 'The operation was aborted due to timeout' });
    expect(await refundWithOutcome({ reference: 'BK-1', amountRands: 100, idempotencyKey: KEY })).toMatchObject({ outcome: 'unknown' });
    paystackRefund.mockRejectedValueOnce(new Error('boom'));
    expect(await refundWithOutcome({ reference: 'BK-1', amountRands: 100, idempotencyKey: KEY })).toMatchObject({ outcome: 'unknown' });
  });

  it('a refund the provider reports failed is rejected', async () => {
    paystackRefund.mockResolvedValueOnce({ ok: true, value: { providerRefundId: '9', status: 'failed', amountCents: 10_000 } });
    expect(await refundWithOutcome({ reference: 'BK-1', amountRands: 100, idempotencyKey: KEY })).toMatchObject({ outcome: 'rejected' });
  });

  it('money taken by hand goes back by hand; a bad amount is refused before any call', async () => {
    expect(await refundWithOutcome({ reference: 'manual:eft:abc', amountRands: 100, idempotencyKey: KEY })).toMatchObject({ outcome: 'manual' });
    expect(await refundWithOutcome({ reference: 'BK-1', amountRands: 0, idempotencyKey: KEY })).toMatchObject({ outcome: 'rejected' });
    expect(await refundWithOutcome({ reference: 'BK-1', amountRands: Number.NaN, idempotencyKey: KEY })).toMatchObject({ outcome: 'rejected' });
    expect(paystackRefund).not.toHaveBeenCalled();
  });

  it('a Yoco payment stays with Yoco; a Yoco failure cannot be told apart, so it is unknown', async () => {
    yocoRefund.mockResolvedValueOnce({ success: true });
    expect(await refundWithOutcome({ reference: 'ch_123', amountRands: 250, idempotencyKey: KEY })).toMatchObject({ outcome: 'refunded' });
    expect(yocoRefund).toHaveBeenCalledWith('ch_123', 250);
    yocoRefund.mockResolvedValueOnce({ success: false, error: 'Refund failed (502)' });
    expect(await refundWithOutcome({ reference: 'ch_123', amountRands: 250, idempotencyKey: KEY })).toMatchObject({ outcome: 'unknown' });
    expect(paystackRefund).not.toHaveBeenCalled();
  });
});
