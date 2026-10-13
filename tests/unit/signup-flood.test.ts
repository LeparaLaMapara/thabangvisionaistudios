import { describe, it, expect, vi, beforeEach } from 'vitest';

// Security test 2026-10-13 (A4): every signup, confirmed or not, cost an AI
// draft and an owner email. Now only confirmed accounts do, under hourly caps.

const sendEmail = vi.fn(async () => ({ ok: true }));
const generateWithFallback = vi.fn(async () => ({ text: 'Hi there, welcome to the studio. We are glad you joined us today.', servedBy: 'test', modelId: 'm', usage: {} }));
const checkRateLimit = vi.fn(async () => true);
const inserted: unknown[] = [];
let confirmed: string | null = null;

vi.mock('@/lib/email', () => ({ email: { sendEmail: (...a: unknown[]) => sendEmail(...(a as [])), isConfigured: () => true } }));
vi.mock('@/lib/ai/resilient', () => ({ generateWithFallback: (...a: unknown[]) => generateWithFallback(...(a as [])) }));
vi.mock('@/lib/ai/tracked', () => ({ logTokenUsage: () => {} }));
vi.mock('@/lib/auth', () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...(a as [])) }));
vi.mock('@/lib/supabase/server', () => {
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'in', 'order', 'limit']) c[k] = () => c;
    c.maybeSingle = async () => result;
    c.then = (res: (v: unknown) => unknown) => res({ count: 0, data: [] });
    return c;
  };
  return {
    createAdminClient: () => ({
      auth: {
        admin: {
          getUserById: async (id: string) => ({
            data: { user: { id, email: 'lerato.m@gmail.com', email_confirmed_at: confirmed, user_metadata: { first_name: 'Lerato' }, app_metadata: { provider: 'email' } } },
          }),
        },
      },
      from: (table: string) => {
        if (table === 'welcome_messages') {
          const c = chain({ data: null }) as Record<string, unknown>;
          c.insert = async (row: unknown) => {
            inserted.push(row);
            return { error: null };
          };
          return c;
        }
        if (table === 'profiles') return chain({ data: { first_name: 'Lerato', display_name: null, verification_status: 'none', marketing_opt_in: false } });
        return chain({ data: null });
      },
    }),
  };
});

const { processSignup } = await import('@/lib/greetings/process');

describe('signup webhook work only for confirmed accounts', () => {
  beforeEach(() => {
    sendEmail.mockClear();
    generateWithFallback.mockClear();
    checkRateLimit.mockReset();
    checkRateLimit.mockResolvedValue(true);
    inserted.length = 0;
  });

  it('an unconfirmed account costs nothing', async () => {
    confirmed = null;
    expect(await processSignup('00000000-0000-4000-8000-000000000001')).toEqual({ status: 'unconfirmed' });
    expect(generateWithFallback).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it('a confirmed account is drafted and announced', async () => {
    confirmed = '2026-10-13T10:00:00Z';
    expect(await processSignup('00000000-0000-4000-8000-000000000002')).toEqual({ status: 'drafted' });
    expect(generateWithFallback).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(inserted).toHaveLength(1);
  });

  it('past the hourly caps: template draft, no owner email', async () => {
    confirmed = '2026-10-13T10:00:00Z';
    checkRateLimit.mockResolvedValue(false);
    expect(await processSignup('00000000-0000-4000-8000-000000000003')).toEqual({ status: 'drafted' });
    expect(generateWithFallback).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect((inserted[0] as { drafted_by: string }).drafted_by).toBe('template');
  });
});
