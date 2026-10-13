/**
 * Audit 2026-10-13 (workstream B): what reads hand back to users, what error
 * text reaches the browser, and money compared in cents.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── A session client that records what each read selected ───────────────────
const selects: Record<string, string[]> = {};
let readError: { message: string } | null = null;

function sessionBuilder(table: string) {
  const b = {
    select: (cols: string) => { (selects[table] ??= []).push(cols); return b; },
    update: () => b,
    eq: () => b,
    in: () => b,
    order: () => b,
    limit: () => b,
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: readError ? null : [], error: readError }).then(res, rej),
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'u@example.com' } } }) },
    from: (t: string) => sessionBuilder(t),
  }),
  createAdminClient: () => ({ from: (t: string) => sessionBuilder(t) }),
}));
vi.mock('@/lib/email', () => ({ email: { sendEmail: async () => undefined } }));

const {
  CLIENT_SERVICE_BOOKING_COLUMNS,
  RENTER_EQUIPMENT_BOOKING_COLUMNS,
  OWN_PROFILE_EDITOR_COLUMNS,
} = await import('@/lib/supabase/queries/columns');

const cols = (list: string): string[] => list.split(',').map((c) => c.trim());

beforeEach(() => {
  for (const k of Object.keys(selects)) delete selects[k];
  readError = null;
});

describe('column lists returned to users', () => {
  it('a client never gets staff notes, provider codes or payout fields', () => {
    const c = cols(CLIENT_SERVICE_BOOKING_COLUMNS);
    for (const hidden of ['admin_notes', 'paystack_access_code', 'paystack_reference', 'creator_amount', 'platform_amount', 'platform_commission', 'payout_reference', 'payout_last_error', 'client_email']) {
      expect(c).not.toContain(hidden);
    }
    // What the client screens read (ServiceBookingsList, timeline, actions).
    for (const used of ['id', 'reference', 'creator_id', 'status', 'payment_status', 'payout_status', 'total', 'delivery_url', 'delivered_at', 'revisions_used', 'revisions_included', 'dispute_window_ends_at', 'completed_at', 'client_rating', 'created_at']) {
      expect(c).toContain(used);
    }
  });

  it('a renter never gets the owner and platform shares or staff notes', () => {
    const c = cols(RENTER_EQUIPMENT_BOOKING_COLUMNS);
    for (const hidden of ['notes', 'owner_share_cents', 'platform_share_cents', 'owner_id', 'payfast_payment_id', 'return_reviewed_by']) {
      expect(c).not.toContain(hidden);
    }
    for (const used of ['id', 'status', 'total_price', 'start_date', 'end_date', 'checkout_group_id', 'fulfilment_method', 'requires_manual_approval']) {
      expect(c).toContain(used);
    }
  });

  it('the profile editor never reads verification evidence', () => {
    const c = cols(OWN_PROFILE_EDITOR_COLUMNS);
    for (const hidden of ['verification_fraud_flags', 'verification_ai_check', 'verification_metadata', 'verification_ip', 'verification_user_agent', 'id_document_hash', 'id_front_path', 'selfie_with_id_path', 'popia_consent_ip', 'role']) {
      expect(c).not.toContain(hidden);
    }
  });

  it('no list uses a wildcard', () => {
    for (const list of [CLIENT_SERVICE_BOOKING_COLUMNS, RENTER_EQUIPMENT_BOOKING_COLUMNS, OWN_PROFILE_EDITOR_COLUMNS]) {
      expect(list).not.toContain('*');
    }
  });
});

describe('routes select the named columns, not *', () => {
  it('GET /api/service-bookings', async () => {
    const { GET } = await import('@/app/api/service-bookings/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(selects.bookings?.[0]).toContain(CLIENT_SERVICE_BOOKING_COLUMNS);
    expect(selects.bookings?.[0]).not.toMatch(/^\*/);
  });

  it('GET /api/bookings', async () => {
    const { GET } = await import('@/app/api/bookings/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(selects.equipment_bookings?.[0]).toContain(RENTER_EQUIPMENT_BOOKING_COLUMNS);
    expect(selects.equipment_bookings?.[0]).not.toMatch(/^\*/);
  });
});

describe('database error text never reaches the browser', () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { spy = vi.spyOn(console, 'error').mockImplementation(() => undefined); });
  afterEach(() => spy.mockRestore());

  it('GET /api/notifications answers a plain message and logs the detail', async () => {
    readError = { message: 'relation "notifications" column secret_x does not exist' };
    const { GET } = await import('@/app/api/notifications/route');
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('secret_x');
    expect(spy).toHaveBeenCalled();
  });
});

describe('money compared in cents', () => {
  it('a charge 1 cent short of the total blocks the payout (rounded rands let R0.49 pass)', async () => {
    const { payoutBlocker } = await import('@/lib/payments/payout');
    const paid = { status: 'completed', payment_status: 'paid', payout_status: 'pending', creator_id: 'c1', creator_amount: 1275, total: 1725 };
    expect(payoutBlocker(paid, { success: true, amount: 1724.51 })).toMatch(/less than the total/);
    expect(payoutBlocker(paid, { success: true, amount: 1724.99 })).toMatch(/less than the total/);
    expect(payoutBlocker(paid, { success: true, amount: Number.NaN })).toMatch(/less than the total/);
    expect(payoutBlocker(paid, { success: true, amount: 1725 })).toBeNull();
  });

  it('a Paystack refund converts rands with toCents (R1.005 is 101 cents, not 100)', async () => {
    const prev = process.env.PAYSTACK_SECRET_KEY;
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_placeholder';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: true, data: { id: 1 } }), { status: 200 }),
    );
    try {
      const { refundPayment } = await import('@/lib/payments/paystack');
      await refundPayment('ref_1', 1.005);
      const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
      expect(body.amount).toBe(101);
    } finally {
      fetchSpy.mockRestore();
      if (prev === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = prev;
    }
  });
});

describe('unauthenticated verification writers are gone', () => {
  it('the queries module no longer exports approve / reject / submit', async () => {
    const mod = (await import('@/lib/supabase/queries/verifications')) as Record<string, unknown>;
    expect(mod.approveVerification).toBeUndefined();
    expect(mod.rejectVerification).toBeUndefined();
    expect(mod.submitVerification).toBeUndefined();
  });
});
