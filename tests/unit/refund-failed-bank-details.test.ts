/**
 * A card refund the provider refused (refund_failed): the renter is asked for
 * a bank account on every channel, with a link to add it; someone who already
 * has a validated account is told nothing is needed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

let tables: Record<string, Record<string, unknown>[]> = {};
const inserts: Record<string, unknown>[][] = [];
function fakeDb() {
  const chain = (rows: Record<string, unknown>[]) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) q[m] = () => q;
    q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    return q;
  };
  return {
    from(table: string) {
      return {
        select: () => chain(tables[table] ?? []),
        insert: (rows: Record<string, unknown>[]) => {
          inserts.push(rows);
          return { select: async () => ({ data: rows.map((r, i) => ({ id: `n${i}`, user_id: r.user_id })), error: null }) };
        },
        update: () => ({ eq: function eq() { return { eq, then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r) }; } }),
      };
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'renter@example.invalid' } } }) } },
  };
}
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => fakeDb(), createClient: async () => ({}) }));
const sendEmail = vi.fn(async (o: { to: string; subject: string; text: string }) => void o);
vi.mock('@/lib/email', () => ({ email: { sendEmail: (o: { to: string; subject: string; text: string }) => sendEmail(o) } }));
const smsSend = vi.fn(async (to: string, text: string) => ({ ok: Boolean(to && text) }));
let smsOn = false;
vi.mock('@/lib/sms', () => ({ sms: { isConfigured: () => smsOn, send: (to: string, text: string) => smsSend(to, text) } }));
const pushToUser = vi.fn(async () => ({ sent: 1 }));
vi.mock('@/lib/push/to-user', () => ({ pushToUser: (...a: unknown[]) => pushToUser(...(a as [])), PUSH_MAX_FAILURES: 3 }));
vi.mock('@/lib/push', async (orig) => ({ ...(await orig<typeof import('@/lib/push')>()), isPushConfigured: () => true }));

const { NOTICE_CHANNELS } = await import('@/lib/core/rental/notifications');
const { supabaseNotify, rentalNoticeText, PHONE_PUSH_KINDS, BANK_DETAILS_PATH } = await import('@/lib/rental/notify');
const { DELIVERY_WHATSAPP_TEMPLATES } = await import('@/lib/whatsapp/delivery-templates');

const msg = (channel: 'in_app' | 'email' | 'sms') => ({
  dedupeKey: `refund_failed:${channel}:u1:r1`, kind: 'refund_failed' as const, channel, userId: 'u1', bookingIds: ['b1'], data: { amountCents: 25000 },
});

beforeEach(() => {
  tables = {};
  inserts.length = 0;
  sendEmail.mockClear();
  smsSend.mockClear();
  pushToUser.mockClear();
  smsOn = false;
});

describe('refund_failed asks for bank details', () => {
  it('goes to every channel, phone push included, and WhatsApp has a template ready', () => {
    expect(NOTICE_CHANNELS.refund_failed).toEqual(['in_app', 'email', 'sms']);
    expect(PHONE_PUSH_KINDS.has('refund_failed')).toBe(true);
    expect(DELIVERY_WHATSAPP_TEMPLATES.find((t) => t.kind === 'refund_failed')?.params).toEqual(['first_name', 'bank_details_url']);
  });

  it('no account yet: says why and links to the bank details form (email, in-app, push)', async () => {
    await supabaseNotify.deliver(msg('email'));
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.to).toBe('renter@example.invalid');
    expect(mail.subject).toContain('Your refund needs your bank details');
    expect(mail.text).toContain('R250');
    expect(mail.text).toContain('card may be cancelled or replaced');
    expect(mail.text).toContain(`Add your bank details: `);
    expect(mail.text).toContain(BANK_DETAILS_PATH);

    await supabaseNotify.deliver(msg('in_app'));
    expect(inserts[0][0]).toMatchObject({ user_id: 'u1', link: BANK_DETAILS_PATH });
    expect(pushToUser).toHaveBeenCalledTimes(1);
  });

  it('SMS: recorded as skipped until SMS is switched on, then sent with the link', async () => {
    expect(await supabaseNotify.deliver(msg('sms'))).toEqual({ ok: false, retryable: false, message: 'sms not configured' });
    smsOn = true;
    tables.profiles = [{ phone: '+27820000000', phone_verified_at: '2026-10-01T00:00:00Z' }];
    expect(await supabaseNotify.deliver(msg('sms'))).toEqual({ ok: true });
    expect(smsSend.mock.calls[0][1]).toContain(BANK_DETAILS_PATH);
  });

  it('a validated account already on file: nothing to do, link to the booking', async () => {
    tables.banking_details = [{ is_verified: true, paystack_recipient_code: 'RCP_x' }];
    await supabaseNotify.deliver(msg('email'));
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.subject).toContain('coming by bank transfer');
    expect(mail.text).toContain('You do not need to do anything');
    expect(mail.text).not.toContain(BANK_DETAILS_PATH);
    expect(rentalNoticeText('refund_failed', { amountCents: 25000, hasBankAccount: true }).body).toContain('R250');
  });
});
