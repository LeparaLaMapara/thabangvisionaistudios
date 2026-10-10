/**
 * Phase 5 (customer experience), the renter's booking page:
 *  - money-view: payments and refunds from the records that hold the money,
 *    never "refunded" before the provider processed it;
 *  - next-step: what happens next for every gear status, one set of status words;
 *  - report: the problem report maps onto the API's types and fields (the old
 *    form sent fields the API refused, so no report ever got through).
 */
import { describe, expect, it } from 'vitest';
import { bookingMoneyView, refundStage } from '@/lib/rental/money-view';
import { gearNextStep } from '@/lib/rental/next-step';
import { gearStatusLabel } from '@/lib/rental/status-words';
import { buildReportRequest, ISSUE_OPTIONS, GEAR_REPORTABLE_STATUSES } from '@/lib/disputes/report';
import { STUDIO } from '@/lib/constants';
import { collectionPointWithCity } from '@/lib/rental/collection-point';

const BOOKING = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('bookingMoneyView', () => {
  const intent = { state: 'paid', expected_amount_cents: 100000, hire_cents: 60000, deposit_cents: 40000, delivery_cents: 0, paid_at: '2026-10-10T08:00:00Z' };

  it('shows the verified charge with its parts', () => {
    const v = bookingMoneyView({ bookingId: BOOKING, orderLineCount: 1, intent, payments: [], refunds: [] });
    expect(v.charged).toEqual({ totalCents: 100000, hireCents: 60000, depositCents: 40000, deliveryCents: null, at: '2026-10-10T08:00:00Z', wholeOrder: false });
    expect(v.awaitingConfirmation).toBe(false);
  });

  it('never shows a charge the provider has not confirmed', () => {
    for (const state of ['initiated', 'failed', 'expired', 'mismatch']) {
      const v = bookingMoneyView({ bookingId: BOOKING, orderLineCount: 1, intent: { ...intent, state }, payments: [], refunds: [] });
      expect(v.charged, state).toBeNull();
    }
    expect(bookingMoneyView({ bookingId: BOOKING, orderLineCount: 1, intent: { ...intent, state: 'initiated' }, payments: [], refunds: [] }).awaitingConfirmation).toBe(true);
  });

  it('falls back to recorded payment lines (older orders, EFT, cash), in rands', () => {
    const v = bookingMoneyView({
      bookingId: BOOKING,
      orderLineCount: 2,
      intent: null,
      payments: [
        { booking_id: BOOKING, amount: '450.50', status: 'succeeded', created_at: '2026-10-01T00:00:00Z' },
        { booking_id: OTHER, amount: 300, status: 'succeeded', created_at: '2026-10-02T00:00:00Z' },
        { booking_id: OTHER, amount: 999, status: 'failed', created_at: '2026-10-03T00:00:00Z' },
      ],
      refunds: [],
    });
    expect(v.charged?.totalCents).toBe(75050);
    expect(v.charged?.wholeOrder).toBe(true);
    expect(v.charged?.at).toBe('2026-10-02T00:00:00Z');
  });

  it('a hand-recorded payment for a multi-line order (one row on one line) is labelled as the whole order', () => {
    const v = bookingMoneyView({
      bookingId: BOOKING,
      orderLineCount: 3,
      intent: null,
      payments: [{ booking_id: BOOKING, amount: 2400, status: 'succeeded', created_at: '2026-10-01T00:00:00Z' }],
      refunds: [],
    });
    expect(v.charged).toMatchObject({ totalCents: 240000, wholeOrder: true });
    const single = bookingMoneyView({ bookingId: BOOKING, orderLineCount: 1, intent: null, payments: [{ booking_id: BOOKING, amount: 500, status: 'succeeded', created_at: '2026-10-01T00:00:00Z' }], refunds: [] });
    expect(single.charged?.wholeOrder).toBe(false);
  });

  it('says nothing was charged when nothing was', () => {
    const v = bookingMoneyView({ bookingId: BOOKING, orderLineCount: 1, intent: null, payments: [], refunds: [] });
    expect(v.charged).toBeNull();
    expect(v.awaitingConfirmation).toBe(false);
  });

  it('lists refunds in order with plain stages; "refunded" only once processed', () => {
    const v = bookingMoneyView({
      bookingId: BOOKING,
      orderLineCount: 1,
      intent,
      payments: [],
      refunds: [
        { id: 'r2', reason: 'deposit_settlement', state: 'processed', amount_cents: 40000, booking_ids: [BOOKING], created_at: '2026-10-12T00:00:00Z', processed_at: '2026-10-13T00:00:00Z' },
        { id: 'r1', reason: 'cancellation', state: 'requested', amount_cents: 30000, booking_ids: [BOOKING], created_at: '2026-10-11T00:00:00Z', processed_at: null },
      ],
    });
    expect(v.refunds.map((r) => [r.id, r.label, r.stage])).toEqual([
      ['r1', 'Cancellation refund', 'initiated'],
      ['r2', 'Deposit returned', 'processed'],
    ]);
    expect(v.refunds[0].stageText).not.toMatch(/refunded/i);
    expect(v.refunds[1].at).toBe('2026-10-13T00:00:00Z');
  });

  it('every refund state has customer words, and problems go to a person without blame', () => {
    for (const s of ['eligible', 'claimed', 'requested', 'pending', 'processing', 'processed', 'failed', 'needs_attention', 'disputed']) {
      expect(refundStage(s).text.length, s).toBeGreaterThan(20);
    }
    for (const s of ['failed', 'needs_attention', 'disputed']) {
      expect(refundStage(s).stage).toBe('needs_person');
      expect(refundStage(s).text).toMatch(/person on our team/);
      expect(refundStage(s).text).not.toMatch(/your fault|you failed/i);
    }
  });

  it('marks an order-wide refund as covering the whole order', () => {
    const v = bookingMoneyView({
      bookingId: BOOKING,
      orderLineCount: 2,
      intent,
      payments: [],
      refunds: [{ id: 'r', reason: 'manual', state: 'pending', amount_cents: 5000, booking_ids: [BOOKING, OTHER], created_at: '2026-10-11T00:00:00Z', processed_at: null }],
    });
    expect(v.refunds[0].wholeOrder).toBe(true);
    expect(v.charged?.wholeOrder).toBe(true);
  });
});

describe('gearNextStep', () => {
  const base = { start_date: '2026-10-19', end_date: '2026-10-21' };
  it('has a next step for every status, in plain words', () => {
    for (const status of ['pending', 'confirmed', 'active', 'overdue', 'return_pending', 'return_reviewed', 'completed', 'disputed', 'cancelled']) {
      const n = gearNextStep({ ...base, status });
      expect(n.title.length, status).toBeGreaterThan(3);
      expect(n.lines.length, status).toBeGreaterThan(0);
      expect(n.lines.join(' ')).not.toMatch(/_/);
    }
  });

  it('a confirmed collection says where, when and what to bring, from constants', () => {
    const n = gearNextStep({ ...base, status: 'confirmed', fulfilment_method: 'collection' });
    const text = `${n.title} ${n.lines.join(' ')}`;
    expect(text).toContain(collectionPointWithCity());
    expect(text).toContain(STUDIO.hours.weekday);
    expect(text).toMatch(/ID you verified with/);
    expect(n.title).toMatch(/19 October/);
  });

  it('a confirmed delivery never sends the renter to the counter', () => {
    const n = gearNextStep({ ...base, status: 'confirmed', fulfilment_method: 'delivery' });
    expect(n.lines.join(' ')).not.toContain(collectionPointWithCity());
    expect(n.lines.join(' ')).not.toMatch(/reminder on the morning of collection/);
  });

  it('a pending EFT order says the dates are held; a card order says do not pay again', () => {
    expect(gearNextStep({ ...base, status: 'pending', payment_method: 'eft' }).lines.join(' ')).toMatch(/dates are held/);
    expect(gearNextStep({ ...base, status: 'pending', payment_method: 'card' }).lines.join(' ')).toMatch(/do not pay again/);
  });

  it('status words are the same everywhere and never raw codes', () => {
    expect(gearStatusLabel('return_pending')).toBe('returned, being checked');
    expect(gearStatusLabel('active')).toBe('on hire');
    expect(gearStatusLabel('something_new')).toBe('something new');
  });
});

describe('buildReportRequest', () => {
  it('a gear report uses the API field names and one of its types', () => {
    const r = buildReportRequest('gear', BOOKING, 'gear_damage', '  The battery grip does not power the camera.  ');
    expect(r).toEqual({ ok: true, body: { dispute_type: 'gear_damage', reason: 'The battery grip does not power the camera.', equipment_booking_id: BOOKING } });
  });

  it('a shoot report goes on the service booking', () => {
    const r = buildReportRequest('service', BOOKING, 'creator_no_show', 'Nobody arrived at the venue at 10:00.');
    expect(r.ok && r.body).toEqual({ dispute_type: 'creator_no_show', reason: 'Nobody arrived at the venue at 10:00.', booking_id: BOOKING });
  });

  it('refuses what the API would refuse, with a plain reason', () => {
    expect(buildReportRequest('gear', BOOKING, 'damage', 'Long enough text here.')).toEqual({ ok: false, message: 'Choose what went wrong.' });
    expect(buildReportRequest('gear', BOOKING, 'creator_no_show', 'Long enough text here.').ok).toBe(false);
    const short = buildReportRequest('gear', BOOKING, 'gear_damage', ' broken ');
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.message).toMatch(/at least 10/);
  });

  it('only offers types the API accepts', () => {
    const accepted = ['gear_damage', 'gear_not_returned', 'creator_no_show', 'client_cancellation', 'quality_dispute', 'payment_dispute'];
    for (const o of [...ISSUE_OPTIONS.gear, ...ISSUE_OPTIONS.service]) expect(accepted).toContain(o.type);
    expect(GEAR_REPORTABLE_STATUSES).not.toContain('cancelled');
    expect(GEAR_REPORTABLE_STATUSES).not.toContain('disputed');
  });
});
