import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/** Paystack Transfer Approval URL: approve only a transfer that matches our own instruction (spec §7.8). */

const state = vi.hoisted(() => ({
  signatureOk: true,
  payout: null as null | Record<string, unknown>,
}));

vi.mock('@/lib/payments/paystack', () => ({ verifySignature: () => state.signatureOk }));
vi.mock('@/lib/data/events', () => ({ logEvent: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: table === 'owner_payouts' ? state.payout : null }) }),
      }),
    }),
  }),
}));

const call = async (data: Record<string, unknown>) => {
  const { POST } = await import('@/app/api/webhooks/paystack/transfer-approval/route');
  return POST(new NextRequest('http://localhost/api/webhooks/paystack/transfer-approval', {
    method: 'POST',
    body: JSON.stringify(data),
    headers: { 'x-paystack-signature': 'sig' },
  }));
};

describe('transfer approval', () => {
  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit';
    state.signatureOk = true;
    state.payout = { transfer_reference: 'tvpo_abc1234567890123', owner_amount_cents: 360000, recipient_code: 'RCP_1', state: 'claimed' };
  });

  const good = { reference: 'tvpo_abc1234567890123', amount: 360000, currency: 'ZAR', recipient: { recipient_code: 'RCP_1' } };

  it('approves an exact match', async () => {
    expect((await call(good)).status).toBe(200);
  });
  it('refuses a bad signature', async () => {
    state.signatureOk = false;
    expect((await call(good)).status).toBe(400);
  });
  it('refuses a changed amount or recipient (T16)', async () => {
    expect((await call({ ...good, amount: 360001 })).status).toBe(400);
    expect((await call({ ...good, recipient: { recipient_code: 'RCP_EVIL' } })).status).toBe(400);
  });
  it('refuses an unknown reference and a payout already paid', async () => {
    state.payout = null;
    expect((await call(good)).status).toBe(400);
    state.payout = { transfer_reference: good.reference, owner_amount_cents: 360000, recipient_code: 'RCP_1', state: 'success' };
    expect((await call(good)).status).toBe(400);
  });
});
