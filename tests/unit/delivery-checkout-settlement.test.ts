/**
 * Where gear-hire settlement meets Phase 4 delivery (risk register R-39, R-40).
 *
 *  R-39: an order with delivery legs earns its fee per leg; take-back must not
 *        post the order-level delivery journal too. Orders without legs keep it.
 *  R-40: an open delivery incident (or a return delivery not yet received and
 *        inspected) holds deposit settlement and owner payout (D17, D29); a
 *        provider-caused or unattributed delay stops the automatic late fee (D19).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { checkPayoutEligibility } from '@/lib/core/rental/payouts';
import { lateFeeAfterDelivery, lateFeeFor } from '@/lib/rental/late-fee';
import { reportIncident } from '@/lib/core/delivery/use-cases';
import { GROUP, RENTER, world } from './helpers/delivery-fakes';

const h = vi.hoisted(() => ({
  transitions: [] as Record<string, unknown>[],
  hold: { allowed: true, reasons: [] as string[], lateFeeAutoCharge: true },
  phase4: false,
  booking: {} as Record<string, unknown>,
}));

/** A query builder that answers by table and by what was selected. */
function db() {
  return {
    from(table: string) {
      let cols = '';
      const b: Record<string, unknown> = {};
      for (const m of ['eq', 'in', 'is', 'not', 'order', 'limit', 'contains', 'or', 'update', 'insert']) b[m] = () => b;
      b.select = (c: string) => {
        cols = c ?? '';
        return b;
      };
      b.maybeSingle = () => b;
      b.single = b.maybeSingle;
      b.then = (resolve: (v: unknown) => unknown) => {
        let data: unknown = null;
        if (table === 'equipment_bookings') {
          const snap = { hire_cents: 100_000, deposit_cents: 250_000, owner_share_cents: 80_000, platform_share_cents: 20_000, ownership: 'community', owner_id: 'owner-1' };
          if (cols.includes('smart_rentals')) data = { smart_rentals: { serial_number: null } };
          else if (cols.includes('hire_cents') && cols.includes('status')) data = { ...h.booking, ...snap };
          else if (cols.includes('hire_cents')) data = snap;
          else if (cols.includes('delivery_fee') && !cols.includes('user_id')) data = [{ id: BK, status: h.booking.status, delivery_fee: 150 }];
          else data = h.booking;
        } else if (table === 'disputes') data = { id: 'dispute-1', equipment_booking_id: BK, booking_id: null, filed_by: RENTER }; else if (table === 'rental_payment_intents') data = { state: 'paid' };
        else if (table === 'profiles') data = { verification_status: 'verified' };
        else if (table === 'banking_details') data = { is_verified: true, paystack_recipient_code: 'RCP_1' };
        else if (table === 'refund_obligations') data = [];
        else if (table === 'owner_payouts') data = { state: 'scheduled' };
        return Promise.resolve({ data, error: null, count: table === 'disputes' ? 0 : null }).then(resolve);
      };
      return b;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => db(), createClient: async () => db() }));
vi.mock('@/lib/auth', () => ({ requireAdmin: async () => ({ user: { id: 'admin-1' } }), rateLimitAdmin: async () => null }));
vi.mock('@/lib/rental/repos', async (orig) => ({
  ...(await orig<typeof import('@/lib/rental/repos')>()),
  transitionBookings: async (_db: unknown, t: Record<string, unknown>) => {
    h.transitions.push(t);
    return { result: 'moved' };
  },
  SupabaseRefunds: class {},
}));
vi.mock('@/lib/rental/delivery-settlement', async (orig) => ({
  ...(await orig<typeof import('@/lib/rental/delivery-settlement')>()),
  deliverySettlement: async () => h.hold,
  usesPhase4Delivery: async () => h.phase4,
}));
vi.mock('@/lib/rental/charges', () => ({ chargeOfBooking: async () => ({ totalCents: 1_000_000, remainderCents: 1_000_000 }) }));
vi.mock('@/lib/rental/notices', () => ({ loadNoticeBookings: async () => [{ title: 'Camera' }], sendGearNotice: async () => undefined }));
vi.mock('@/lib/rental/notify', () => ({ dispatchOutbox: async () => undefined }));
vi.mock('@/lib/data/events', () => ({ logEvent: vi.fn() }));
vi.mock('@/lib/analytics/funnel', () => ({ trackFunnel: vi.fn() }));
vi.mock('@/lib/payments/ports', () => ({ paymentPort: {} }));
vi.mock('@/lib/email', () => ({ sendDisputeResolved: async () => undefined }));
vi.mock('@/lib/supabase/profile-email', () => ({ profileWithEmail: async () => null }));

const BK = '00000000-0000-4000-8000-0000000bb001';
const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function takeBack() {
  const { POST } = await import('@/app/api/admin/rentals/[id]/take-back/route');
  const res = await POST(
    new NextRequest(`http://localhost/api/admin/rentals/${BK}/take-back`, { method: 'POST', body: JSON.stringify({ condition: 'good', photos: ['https://img.example/1.jpg'], serialsConfirmed: true }) }),
    { params: Promise.resolve({ id: BK }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const completion = () => h.transitions.find((t) => t.to === 'completed') as { journals: { idempotencyKey: string; lines?: unknown }[]; patch: Record<string, unknown>; refunds: { amountCents: number }[] } | undefined;

describe('take-back with Phase 4 delivery', () => {
  beforeEach(() => {
    h.transitions = [];
    h.hold = { allowed: true, reasons: [], lateFeeAutoCharge: true };
    h.phase4 = false;
    h.booking = {
      id: BK, user_id: RENTER, status: 'active', end_date: daysAgo(0), quantity: 1, deposit_amount: 2_500, total_price: 1_000,
      payment_plan: 'full', checkout_group_id: GROUP, payfast_payment_id: 'T_provider_1', notes: null, balance_due: null, delivery_fee: 150,
    };
  });

  it('R-39: an order without delivery legs keeps the order-level delivery journal', async () => {
    const r = await takeBack();
    expect(r.status).toBe(200);
    expect(completion()?.journals.map((j) => j.idempotencyKey)).toContain(`delivery:${GROUP}`);
  });

  it('R-39: an order with delivery legs never posts it (the legs earn the fee): no double earn', async () => {
    h.phase4 = true;
    const r = await takeBack();
    expect(r.status).toBe(200);
    const keys = completion()?.journals.map((j) => j.idempotencyKey) ?? [];
    expect(keys.filter((k) => k.startsWith('delivery:'))).toEqual([]);
    // The hire and the deposit still settle.
    expect(keys).toEqual(expect.arrayContaining([`deposit:${BK}`]));
  });

  it('R-40: an open delivery incident holds settlement; the return is recorded, nothing is released', async () => {
    h.hold = { allowed: false, reasons: ['open_delivery_incident'], lateFeeAutoCharge: true };
    const r = await takeBack();
    expect(r).toMatchObject({ status: 409, body: { code: 'DELIVERY_SETTLEMENT_HELD', recorded: true } });
    expect(h.transitions.map((t) => t.to)).toEqual(['return_pending']);
    expect(completion()).toBeUndefined();
  });

  it('R-40 / D19: a provider-caused delay on the return stops the automatic late fee', async () => {
    h.booking.end_date = daysAgo(3);
    await takeBack();
    const charged = completion()?.patch.late_fee as number;
    expect(charged).toBeGreaterThan(0);

    h.transitions = [];
    h.hold = { allowed: true, reasons: [], lateFeeAutoCharge: false };
    await takeBack();
    expect(completion()?.patch.late_fee).toBe(0);
    expect((completion()?.patch as { inspection_outcome?: string }).inspection_outcome).toBe('clean');
    // The whole deposit goes back.
    expect(completion()?.refunds[0].amountCents).toBe(250_000);
  });
});

async function resolveDispute() {
  const { PATCH } = await import('@/app/api/admin/disputes/[id]/route');
  const res = await PATCH(new NextRequest('http://localhost/api/admin/disputes/dispute-1', { method: 'PATCH', body: JSON.stringify({ status: 'resolved', resolution: 'no_action' }) }), { params: Promise.resolve({ id: 'dispute-1' }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('gear dispute settlement with Phase 4 delivery', () => {
  beforeEach(() => {
    h.transitions = [];
    h.hold = { allowed: true, reasons: [], lateFeeAutoCharge: true };
    h.phase4 = false;
    h.booking = {
      id: BK, user_id: RENTER, status: 'disputed', checkout_group_id: GROUP, payfast_payment_id: 'T_provider_1', deposit_amount: 2_500,
      delivery_fee: 150, payment_plan: 'full', balance_due: null,
    };
  });

  it('R-39: legacy order keeps the order-level delivery journal; a Phase 4 order never posts it', async () => {
    expect((await resolveDispute()).status).toBe(200);
    expect(completion()?.journals.map((j) => j.idempotencyKey)).toContain(`delivery:${GROUP}`);
    h.transitions = [];
    h.phase4 = true;
    expect((await resolveDispute()).status).toBe(200);
    const keys = completion()?.journals.map((j) => j.idempotencyKey) ?? [];
    expect(keys.filter((k) => k.startsWith('delivery:'))).toEqual([]);
    expect(keys).toContain(`dispute-settled:${BK}`);
  });

  it('R-40: an open delivery incident holds the dispute settlement', async () => {
    h.hold = { allowed: false, reasons: ['open_delivery_incident'], lateFeeAutoCharge: true };
    const r = await resolveDispute();
    expect(r.status).toBe(409);
    expect(String(r.body.error)).toMatch(/delivery incident/);
    expect(h.transitions).toHaveLength(0);
  });
});

describe('late fee and payout guards', () => {
  it('lateFeeAfterDelivery waives only when delivery says so', () => {
    const p = { endDate: '2026-10-01', returnedAt: new Date('2026-10-05T12:00:00+02:00'), quantity: 1, deposit: 2_500 };
    expect(lateFeeFor(p).fee).toBeGreaterThan(0);
    expect(lateFeeAfterDelivery(p, { lateFeeAutoCharge: true })).toMatchObject({ fee: lateFeeFor(p).fee, waivedForDelivery: false });
    expect(lateFeeAfterDelivery(p, { lateFeeAutoCharge: false })).toMatchObject({ fee: 0, waivedForDelivery: true, daysLate: lateFeeFor(p).daysLate });
  });

  it('an owner payout is held while a delivery holds settlement', () => {
    const facts = {
      ownerVerified: true, payoutRecipientValidated: true, bookingStatus: 'completed', rentalPaymentConfirmed: true, inspectionCompleted: true,
      openPayoutBlockingDisputes: 0, depositSettled: true, payoutAlreadyStarted: false, completedAt: '2026-10-01T00:00:00Z',
    };
    const now = new Date('2026-10-09T00:00:00Z');
    expect(checkPayoutEligibility(facts, now, 48)).toMatchObject({ eligible: true });
    expect(checkPayoutEligibility({ ...facts, deliveryHoldReasons: ['open_delivery_incident'] }, now, 48)).toMatchObject({ eligible: false, reasons: ['delivery_open_delivery_incident'] });
  });

  it('evaluatePayout asks delivery before paying an owner (R-40)', async () => {
    const { evaluatePayout } = await import('@/lib/rental/workers');
    h.booking = { status: 'completed', completed_at: '2026-10-01T00:00:00Z', inspection_outcome: 'clean', return_reviewed_at: null, checkout_group_id: GROUP, payfast_payment_id: 'T_1', payment_plan: 'full', balance_due: null };
    const now = new Date('2026-10-09T00:00:00Z');
    h.hold = { allowed: true, reasons: [], lateFeeAutoCharge: true };
    expect(await evaluatePayout(db() as never, { booking_id: BK, owner_id: 'owner-1' }, now)).toEqual({ eligible: true, recipientCode: 'RCP_1' });
    h.hold = { allowed: false, reasons: ['open_delivery_incident'], lateFeeAutoCharge: true };
    expect(await evaluatePayout(db() as never, { booking_id: BK, owner_id: 'owner-1' }, now)).toEqual({ eligible: false, reasons: ['delivery_open_delivery_incident'] });
  });

  it('checkRentalSettlement (real) with a reported incident: settlement blocked, late fee not automatic', async () => {
    const { checkRentalSettlement, commitDelivery, markDeliveryQuotesPaid, prepareDelivery, quoteDelivery } = await import('@/lib/core/delivery/use-cases');
    const w = world({ providers: 'manual' });
    const q = await quoteDelivery({ caller: { kind: 'renter', userId: RENTER }, renterId: RENTER, bookingGroupId: GROUP, leg: 'return', originAddressId: 'addr-renter', destinationAddressId: 'addr-office', lines: [{ rentalId: 'cam-1', bookingId: 'bk-1', unitReplacementValueCents: 1_500_000, quantity: 1, startDate: '2026-10-20', endDate: '2026-10-22', driverLabel: 'camera equipment', weightGrams: null, containsLithium: true }], window: { start: '2026-10-22T10:00:00Z', end: '2026-10-22T15:00:00Z' } }, w.deps);
    if (!q.ok) throw new Error(q.code);
    w.bookings.setStatus(GROUP, 'active');
    const p = await prepareDelivery({ caller: { kind: 'system' }, quoteId: q.quotes[0].id, bookingGroupId: GROUP }, w.deps);
    if (!p.ok) throw new Error(p.code);
    await markDeliveryQuotesPaid({ paymentReference: 'pay-ref-1', bookingGroupId: GROUP, renterId: RENTER, quoteIds: [q.quotes[0].id], paidDeliveryCents: q.quotes[0].customerFeeCents }, w.deps);
    await commitDelivery({ caller: { kind: 'system' }, shipmentId: p.shipment.id }, w.deps);
    // Before anything is received back: the deposit waits for inspection (D17).
    expect(await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-1' }, w.deps)).toMatchObject({ allowed: false, lateFeeAutoCharge: true });
    await reportIncident({ caller: { kind: 'renter', userId: RENTER }, shipmentId: p.shipment.id, kind: 'delayed', description: 'Driver did not arrive' }, w.deps);
    const after = await checkRentalSettlement({ bookingGroupId: GROUP, bookingId: 'bk-1' }, w.deps);
    expect(after).toMatchObject({ allowed: false, lateFeeAutoCharge: false });
    expect(after.reasons).toContain('open_delivery_incident');
  });
});
