import { describe, it, expect, vi, beforeEach } from 'vitest';

// The real Ubunye executor (lib/agent/offers.ts), not the in-memory fake:
// it books only at the amount the person approved, and never a creator's
// own package for that creator.

type Row = Record<string, unknown>;
let rental: Row;
let profile: Row | null;
const inserts: Row[] = [];

function builder(table: string) {
  let op: 'select' | 'insert' | 'update' = 'select';
  let values: Row = {};
  const b = {
    select: () => b,
    insert: (v: Row) => { op = 'insert'; values = v; return b; },
    update: (v: Row) => { op = 'update'; values = v; return b; },
    eq: () => b,
    is: () => b,
    maybeSingle: async () => ({ data: table === 'smart_rentals' ? rental : table === 'profiles' ? profile : null, error: null }),
    single: async () => {
      if (op === 'insert') { inserts.push({ table, ...values }); return { data: { id: 'b1', reference: values.reference }, error: null }; }
      return { data: null, error: { message: 'unexpected' } };
    },
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res),
  };
  return b;
}

const addToCart = vi.fn(async () => ({ id: 'ci1' }));
let pkg: { title: string; price: number; priceUnit: string; hours: number | null; creatorId: string | null } | null = null;

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/supabase/queries/cart', () => ({ addToCart }));
vi.mock('@/lib/rental/availability-server', () => ({ availabilityFor: async () => ({ available: true }) }));
vi.mock('@/lib/rental/eligibility-server', () => ({ checkRenterEligibility: async () => ({ ok: true, collectionRequired: false, collectionReasons: [] }) }));
vi.mock('@/lib/rental/leadTime', () => ({ meetsLeadTime: () => true, leadTimeMessage: () => '' }));
vi.mock('@/lib/bookings/packages', () => ({ getBookablePackage: async () => pkg }));
vi.mock('@/lib/payments', () => ({ payments: { isConfigured: () => false } }));
vi.mock('@/lib/payments/offline', () => ({ reportUnpaidRequest: () => undefined, PAYMENTS_OFF_MESSAGE: 'offline' }));
vi.mock('@/lib/email', () => ({ email: { sendEmail: async () => undefined } }));
vi.mock('@/lib/data/events', () => ({ logEvent: () => undefined }));

const { executorFor, requote, prepareService } = await import('@/lib/agent/offers');

const USER = { id: 'u1', email: 'u1@example.invalid', email_confirmed_at: '2026-01-01' };
const gear = { rental_id: 'r1', start_date: '2026-11-02', end_date: '2026-11-04', quantity: 1 };

describe('Ubunye executor books only at the approved amount', () => {
  beforeEach(() => {
    addToCart.mockClear();
    inserts.length = 0;
    pkg = null;
    rental = { id: 'r1', title: 'Sony FX3', brand: 'Sony', model: 'FX3', quantity: 1, is_available: true, price_per_day: 1000, price_per_week: null, deposit_amount: null, replacement_value: 20000 };
    profile = { display_name: 'Creator', verification_status: 'verified', available_for_hire: true, is_suspended: false };
  });

  it('gear: the approved amount books it', async () => {
    const q = await requote('gear_booking', gear);
    if (!q.ok) throw new Error(q.message);
    const out = await executorFor(USER, null)('gear_booking', gear, USER.id, q.amountCents);
    expect(out.ok).toBe(true);
    expect(addToCart).toHaveBeenCalledTimes(1);
  });

  it('gear: a price that moved after approval books nothing', async () => {
    const q = await requote('gear_booking', gear);
    if (!q.ok) throw new Error(q.message);
    rental.price_per_day = 1200;
    const out = await executorFor(USER, null)('gear_booking', gear, USER.id, q.amountCents);
    expect(out).toMatchObject({ ok: false, message: expect.stringMatching(/price changed/i) });
    expect(addToCart).not.toHaveBeenCalled();
  });

  const service = { creator_id: null, project_category: 'photography', project_description: 'A product shoot for our new range of shoes.', deliverables: '20 edited photos', duration_hours: 2, location: null, preferred_dates: null, package_id: 'p1' };

  it('service: a price that moved after approval creates no booking', async () => {
    pkg = { title: 'Product shoot', price: 3000, priceUnit: 'fixed', hours: 2, creatorId: 'c1' };
    const q = await requote('service_booking', service);
    if (!q.ok) throw new Error(q.message);
    pkg = { ...pkg, price: 3500 };
    const out = await executorFor(USER, null)('service_booking', service, USER.id, q.amountCents);
    expect(out).toMatchObject({ ok: false, message: expect.stringMatching(/price changed/i) });
    expect(inserts).toHaveLength(0);
    pkg = { ...pkg, price: 3000 };
    expect((await executorFor(USER, null)('service_booking', service, USER.id, q.amountCents)).ok).toBe(true);
    expect(inserts).toHaveLength(1);
  });

  it('service: a creator cannot book their own package', async () => {
    pkg = { title: 'Product shoot', price: 3000, priceUnit: 'fixed', hours: 2, creatorId: USER.id };
    const prepared = await prepareService(USER, service);
    expect(prepared).toMatchObject({ ok: false, message: expect.stringMatching(/cannot book yourself/i) });
    const q = await requote('service_booking', service);
    if (!q.ok) throw new Error(q.message);
    expect((await executorFor(USER, null)('service_booking', service, USER.id, q.amountCents)).ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });
});
