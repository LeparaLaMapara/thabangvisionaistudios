import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTransferRecipient } from '@/lib/payments/paystack';

const ACCOUNT = '62012345678';

describe('createTransferRecipient (South African bank accounts)', () => {
  const fetchMock = vi.fn();
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

  beforeEach(() => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_dummy_not_a_real_key');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    errorSpy.mockClear();
    logSpy.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("posts type 'basa' and currency 'ZAR' to api.paystack.co/transferrecipient", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: true, data: { recipient_code: 'RCP_abc123' } }), { status: 200 }));

    const result = await createTransferRecipient({ name: 'T Creator', accountNumber: ACCOUNT, bankCode: '250655' });

    expect(result).toEqual({ success: true, recipientCode: 'RCP_abc123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const u = new URL(url);
    expect(u.protocol).toBe('https:');
    expect(u.hostname).toBe('api.paystack.co');
    expect(u.pathname).toBe('/transferrecipient');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ type: 'basa', name: 'T Creator', account_number: ACCOUNT, bank_code: '250655', currency: 'ZAR' });
    expect(body.type).not.toBe('nuban');
  });

  it('returns the provider message on a rejection, without logging the account number', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: false, message: 'Account number is invalid.' }), { status: 400 }));
    const result = await createTransferRecipient({ name: 'T Creator', accountNumber: ACCOUNT, bankCode: '250655' });
    expect(result).toEqual({ success: false, error: 'Account number is invalid.' });
    const logged = JSON.stringify([...errorSpy.mock.calls, ...logSpy.mock.calls]);
    expect(logged).not.toContain(ACCOUNT);
  });

  it('reports an unreachable provider separately, without logging the account number', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const result = await createTransferRecipient({ name: 'T Creator', accountNumber: ACCOUNT, bankCode: '250655' });
    expect(result).toMatchObject({ success: false, unreachable: true });
    const logged = JSON.stringify([...errorSpy.mock.calls, ...logSpy.mock.calls]);
    expect(logged).not.toContain(ACCOUNT);
  });
});

describe('payout abstraction', () => {
  it('createPayoutRecipient delegates to the provider', async () => {
    vi.resetModules();
    vi.doMock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));
    vi.doMock('@/lib/email', () => ({ email: { sendEmail: async () => undefined } }));
    const create = vi.fn(async () => ({ success: true as const, recipientCode: 'RCP_x' }));
    vi.doMock('@/lib/payments/paystack', async (orig) => ({ ...(await orig<object>()), createTransferRecipient: create }));
    const { createPayoutRecipient } = await import('@/lib/payments/payout');
    const r = await createPayoutRecipient({ name: 'A', accountNumber: ACCOUNT, bankCode: '1' });
    expect(r).toEqual({ success: true, recipientCode: 'RCP_x' });
    expect(create).toHaveBeenCalledWith({ name: 'A', accountNumber: ACCOUNT, bankCode: '1' });
    vi.doUnmock('@/lib/payments/paystack');
    vi.doUnmock('@/lib/supabase/server');
    vi.doUnmock('@/lib/email');
  });
});
