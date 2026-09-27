import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/email', () => ({ email: { sendEmail: async () => undefined } }));

const { payoutBlocker } = await import('@/lib/payments/payout');

const paid = { status: 'completed', payment_status: 'paid', payout_status: 'pending', creator_id: 'c1', creator_amount: 1275, total: 1725 };
const confirmed = { success: true, amount: 1725 };

describe('a creator is paid only for a completed booking the provider confirms was paid', () => {
  it('allows a completed, paid, provider-confirmed booking', () => {
    expect(payoutBlocker(paid, confirmed)).toBeNull();
  });

  it('refuses when the provider does not confirm the payment (a forged "paid" row)', () => {
    expect(payoutBlocker(paid, { success: false, amount: 0 })).toMatch(/does not confirm/);
    expect(payoutBlocker(paid, null)).toMatch(/does not confirm/);
  });

  it('refuses when the provider confirms less than the booking total', () => {
    expect(payoutBlocker(paid, { success: true, amount: 100 })).toMatch(/less than the total/);
  });

  it('refuses unpaid, unfinished or already started payouts', () => {
    expect(payoutBlocker({ ...paid, payment_status: 'unpaid' }, confirmed)).toMatch(/not marked paid/);
    expect(payoutBlocker({ ...paid, status: 'delivered' }, confirmed)).toMatch(/not completed/);
    expect(payoutBlocker({ ...paid, payout_status: 'processing' }, confirmed)).toMatch(/already started/);
    expect(payoutBlocker({ ...paid, payout_status: 'paid' }, confirmed)).toMatch(/already started/);
  });

  it('refuses a creator amount larger than what the client paid', () => {
    expect(payoutBlocker({ ...paid, creator_amount: 99999 }, confirmed)).toMatch(/more than the booking total/);
  });
});
