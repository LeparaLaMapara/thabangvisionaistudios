export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { logEvent } from '@/lib/data/events';
import { DELIVERY_OPS } from '@/lib/constants';
import { INCIDENT_KINDS, type IncidentKind, type DeliveryIncident } from '@/lib/core/delivery/incidents';
import {
  advanceManualDelivery,
  cancelDelivery,
  closeDeliveryReview,
  commitDelivery,
  confirmCollection,
  confirmHandover,
  quoteDelivery,
  reconcileDelivery,
  recordReturnInspection,
  reportIncident,
  resolveIncident,
  type DeliveryCaller,
} from '@/lib/core/delivery/use-cases';
import { drainDeliveryInbox } from '@/lib/delivery/inbox';
import { SupabaseDeliveryJobQueries, deemDeliveryAcceptances, pollTrackedShipments, reconcileUncertainDispatches } from '@/lib/delivery/jobs';
import { legInputsFor, loadDeliveryOpsQueues, photoEvidence, quoteReadyNotices, revealShipmentAddress, sastDayWindow } from '@/lib/delivery/ops';
import { SupabaseDeliveryInbox } from '@/lib/delivery/repos';
import { deliveryDeps } from '@/lib/delivery/server';
import { dispatchAfterManualPayment } from '@/lib/delivery/after-payment';
import { SupabaseQuoteLinks } from '@/lib/delivery/checkout';
import { dispatchOutbox } from '@/lib/rental/notify';
import { manualReference } from '@/lib/payments/routing';
import { toCents } from '@/lib/core/pricing/money';
import { deliveryActionRateTier } from '@/lib/delivery/staff-rate-tier';

/**
 * Delivery operations for staff (spec Phase 4 §4.18). GET lists the queues;
 * POST runs one action through the SAME delivery use cases the rest of the
 * platform uses, as `{ kind: 'staff', userId }`, so every rule (custody
 * order, who may confirm what, cancellation windows, reconciliation) is
 * enforced by the core, not here. Hiding a button is not authorisation: each
 * call requires an admin session, and POST is rate limited (progress records
 * on the everyday admin limit, money and courier bookings on the strict one).
 *
 * Logging: every action is logged with ids and outcomes only (never an
 * address, phone number or free text). The use cases add their own records:
 * the canonical event, custody events and proofs.
 *
 * Addresses (D21): never in the queues. `reveal_address` returns one side of
 * one shipment for dispatch, and is itself logged.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const MANUAL_STATES = ['courier_assigned', 'courier_at_pickup', 'in_transit', 'courier_at_dropoff', 'delivery_attempt_failed'] as const;
const LIABILITY: readonly DeliveryIncident['liability'][] = ['undetermined', 'provider', 'renter', 'owner', 'platform', 'none'];
const RESCHEDULABLE = ['prepared', 'booking', 'scheduled', 'courier_assigned'] as const;
const REVIEW_TARGETS = ['delivered', 'lost', 'damaged', 'failed'] as const;
const MANUAL_METHODS = ['eft', 'cash', 'card_link'] as const;

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  try {
    return NextResponse.json(await loadDeliveryOpsQueues(createAdminClient(), new Date()));
  } catch (err) {
    console.error('[admin-delivery] queues failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Could not load the delivery queues.' }, { status: 500 });
  }
}

type Body = Record<string, unknown> & { action?: unknown };

function custodyFields(b: Body): { ok: true; value: { bookingId: string; rentalId: string; evidence: { kind: 'photo'; ref: string }[]; condition: string | null; accessories: { name: string; present: boolean }[]; serialConfirmed: boolean; discrepancies: string[] } } | { ok: false; message: string } {
  if (!isId(b.bookingId) || !isId(b.rentalId)) return { ok: false, message: 'Choose the item.' };
  const photos = photoEvidence(b.photos);
  if (!photos.ok) return photos;
  const accessories = Array.isArray(b.accessories)
    ? b.accessories.slice(0, 30).flatMap((a) => (a && typeof a === 'object' && typeof (a as Row).name === 'string' ? [{ name: text((a as Row).name, 80), present: (a as Row).present === true }] : []))
    : [];
  const discrepancies = Array.isArray(b.discrepancies) ? b.discrepancies.slice(0, 10).map((d) => text(d, 300)).filter(Boolean) : [];
  return {
    ok: true,
    value: {
      bookingId: b.bookingId,
      rentalId: b.rentalId,
      evidence: photos.evidence as { kind: 'photo'; ref: string }[],
      condition: text(b.condition, 500) || null,
      accessories,
      serialConfirmed: b.serialConfirmed === true,
      discrepancies,
    },
  };
}
type Row = Record<string, unknown>;

/** Map a use-case refusal to an HTTP answer. */
function refusal(r: { code: string; message: string }): NextResponse {
  const status = r.code === 'not_found' ? 404 : r.code === 'not_allowed' || r.code === 'actor_not_allowed' ? 403 : r.code.endsWith('_required') || r.code === 'invalid_amount' ? 400 : 409;
  return NextResponse.json({ error: r.message, code: r.code }, { status });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = (await request.json().catch(() => null)) as Body | null;
  // Recording a delivery's progress counts against the everyday admin limit;
  // money, courier bookings and liability decisions against the strict one
  // (lib/delivery/staff-rate-tier.ts). An unreadable body counts as strict.
  const limited = await rateLimitAdmin(auth.user.id, deliveryActionRateTier(body));
  if (limited) return limited;
  if (!body || typeof body !== 'object' || typeof body.action !== 'string') {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }
  const action = body.action;
  const staff: DeliveryCaller = { kind: 'staff', userId: auth.user.id };
  // Ids and outcomes only: never addresses, contact details or free text.
  const audit = (meta: Record<string, string | number | boolean | null>) =>
    logEvent({ eventType: `delivery_ops_${action}`, eventCategory: 'admin', userId: auth.user.id, metadata: meta });
  const flush = () => dispatchOutbox(10).catch(() => undefined);

  try {
    switch (action) {
      case 'advance_manual': {
        if (!isId(body.shipmentId) || !MANUAL_STATES.includes(body.state as (typeof MANUAL_STATES)[number])) return NextResponse.json({ error: 'Choose the delivery and the new state.' }, { status: 400 });
        const outcome = await advanceManualDelivery({ caller: staff, shipmentId: body.shipmentId, state: body.state as (typeof MANUAL_STATES)[number] }, await deliveryDeps());
        audit({ shipmentId: body.shipmentId, state: String(body.state), outcome });
        if (outcome === 'not_found') return NextResponse.json({ error: 'Delivery not found.' }, { status: 404 });
        if (outcome !== 'applied') return NextResponse.json({ error: `Not applied (${outcome.replace(/_/g, ' ')}).`, code: outcome }, { status: 409 });
        await flush();
        return NextResponse.json({ ok: true, outcome });
      }

      case 'record_collection':
      case 'record_handover':
      case 'record_inspection': {
        if (!isId(body.shipmentId)) return NextResponse.json({ error: 'Choose the delivery.' }, { status: 400 });
        const f = custodyFields(body);
        if (!f.ok) return NextResponse.json({ error: f.message }, { status: 400 });
        const deps = await deliveryDeps();
        const input = { caller: staff, shipmentId: body.shipmentId, ...f.value };
        let r;
        if (action === 'record_collection') r = await confirmCollection(input, deps);
        else if (action === 'record_inspection') r = await recordReturnInspection(input, deps);
        else {
          // Staff never accept for the renter (D15, D-43): only delivered, exception or received.
          const outcome = body.outcome;
          if (outcome !== 'delivered' && outcome !== 'exception' && outcome !== 'received') return NextResponse.json({ error: 'Only the renter can accept a delivery.' }, { status: 400 });
          const exceptionKind = body.exceptionKind === 'lost' ? 'lost' : 'damaged';
          r = await confirmHandover({ ...input, outcome, exceptionKind }, deps);
        }
        audit({ shipmentId: body.shipmentId, bookingId: f.value.bookingId, rentalId: f.value.rentalId, photos: f.value.evidence.length, outcome: r.ok ? (r.duplicate ? 'duplicate' : 'recorded') : r.code });
        if (!r.ok) return refusal(r);
        await flush();
        return NextResponse.json({ ok: true, duplicate: r.duplicate, status: r.shipment.status, incidentId: r.incidentId ?? null });
      }

      case 'report_incident': {
        if (!isId(body.shipmentId) || !INCIDENT_KINDS.includes(body.kind as IncidentKind)) return NextResponse.json({ error: 'Choose the delivery and what happened.' }, { status: 400 });
        const photos = photoEvidence(body.photos);
        if (!photos.ok) return NextResponse.json({ error: photos.message }, { status: 400 });
        const providerCaused = body.providerCaused === true ? true : body.providerCaused === false ? false : null;
        const r = await reportIncident(
          { caller: staff, shipmentId: body.shipmentId, kind: body.kind as IncidentKind, description: text(body.description, 2000), evidence: photos.evidence, providerCaused },
          await deliveryDeps(),
        );
        audit({ shipmentId: body.shipmentId, kind: String(body.kind), outcome: r.ok ? (r.duplicate ? 'duplicate' : 'opened') : r.code, incidentId: r.ok ? r.incidentId : null });
        if (!r.ok) return refusal(r);
        await flush();
        return NextResponse.json({ ok: true, incidentId: r.incidentId, duplicate: r.duplicate });
      }

      case 'resolve_incident': {
        // Liability is chosen by this person; nothing is decided automatically.
        if (!isId(body.incidentId) || !LIABILITY.includes(body.liability as DeliveryIncident['liability'])) return NextResponse.json({ error: 'Choose the incident and who is liable (or undetermined).' }, { status: 400 });
        const providerCaused = body.providerCaused === true ? true : body.providerCaused === false ? false : null;
        const r = await resolveIncident(
          { caller: staff, incidentId: body.incidentId, resolution: text(body.resolution, 2000), providerCaused, liability: body.liability as DeliveryIncident['liability'] },
          await deliveryDeps(),
        );
        audit({ incidentId: body.incidentId, liability: String(body.liability), providerCaused, outcome: r.ok ? 'resolved' : r.code });
        if (!r.ok) return refusal(r);
        return NextResponse.json({ ok: true });
      }

      case 'cancel': {
        if (!isId(body.shipmentId)) return NextResponse.json({ error: 'Choose the delivery.' }, { status: 400 });
        const reason = text(body.reason, 500);
        if (reason.length < 3) return NextResponse.json({ error: 'Say why the delivery is cancelled.' }, { status: 400 });
        const initiatedBy = body.initiatedBy === 'renter' || body.initiatedBy === 'provider' ? body.initiatedBy : 'platform';
        const r = await cancelDelivery({ caller: staff, shipmentId: body.shipmentId, reason, initiatedBy }, await deliveryDeps());
        audit({ shipmentId: body.shipmentId, initiatedBy, outcome: r.ok ? (r.duplicate ? 'duplicate' : 'cancelled') : r.code, refundCents: r.ok ? r.refundCents : null, providerFeeCents: r.ok ? r.providerFeeCents : null });
        if (!r.ok) return refusal(r);
        await flush();
        return NextResponse.json(r);
      }

      case 'dispatch': {
        // Staff approve and dispatch a prepared leg (own fleet: assigns our driver task), or retry
        // one whose outcome is unknown: the core asks the provider first and never books twice.
        if (!isId(body.shipmentId)) return NextResponse.json({ error: 'Choose the delivery.' }, { status: 400 });
        const r = await commitDelivery({ caller: staff, shipmentId: body.shipmentId }, await deliveryDeps());
        audit({ shipmentId: body.shipmentId, outcome: r.ok ? r.outcome : r.code });
        if (!r.ok) return refusal(r);
        await flush();
        return NextResponse.json({ ok: true, outcome: r.outcome, status: r.shipment.status });
      }

      case 'reschedule': {
        // Only our own fleet can move a window: no courier adapter offers rescheduling, so a
        // courier leg is cancelled and quoted again instead.
        if (!isId(body.shipmentId)) return NextResponse.json({ error: 'Choose the delivery.' }, { status: 400 });
        const window = typeof body.date === 'string' ? sastDayWindow(body.date) : null;
        if (!window) return NextResponse.json({ error: 'Choose the new date (YYYY-MM-DD).' }, { status: 400 });
        const deps = await deliveryDeps();
        const s = await deps.repo.getShipment(body.shipmentId);
        if (!s) return NextResponse.json({ error: 'Delivery not found.' }, { status: 404 });
        if (s.providerKind !== 'own_fleet') return NextResponse.json({ error: 'This provider does not support rescheduling. Cancel the leg and quote it again.', code: 'not_supported' }, { status: 409 });
        if (!RESCHEDULABLE.includes(s.status as (typeof RESCHEDULABLE)[number])) return NextResponse.json({ error: 'The gear is already on its way.', code: 'too_late' }, { status: 409 });
        const now = deps.clock.now().toISOString();
        const logged = await deps.repo.transitionShipment({
          shipmentId: s.id,
          from: [s.status],
          to: s.status,
          patch: {},
          event: { source: 'staff', actorId: auth.user.id, dedupeKey: `reschedule:${s.id}:${window.start}`, providerState: null, occurredAt: now, note: `rescheduled to ${window.start}/${window.end}` },
          custody: [],
          proofs: [],
          incidents: [],
          journals: [],
          notices: [],
          refund: null,
        });
        if (logged === 'conflict') return NextResponse.json({ error: 'The delivery changed; reload.' }, { status: 409 });
        // Logged once (dedupe key); the window writes are idempotent, so a retry completes them.
        const db = createAdminClient();
        const [a, b] = await Promise.all([
          db.from('delivery_shipments').update({ window_start: window.start, window_end: window.end, updated_at: now }).eq('id', s.id).eq('status', s.status),
          db.from('delivery_manual_tasks').update({ window_start: window.start, window_end: window.end, updated_at: now }).eq('merchant_reference', s.merchantReference),
        ]);
        if (a.error || b.error) return NextResponse.json({ error: 'The change was logged but the window could not be saved. Try again.' }, { status: 500 });
        audit({ shipmentId: s.id, outcome: logged });
        return NextResponse.json({ ok: true, outcome: logged, window });
      }

      case 'reconcile_invoice': {
        const ref = text(body.providerInvoiceRef, 120);
        if (!isId(body.shipmentId) || ref.length < 2) return NextResponse.json({ error: 'Choose the delivery and enter the invoice reference.' }, { status: 400 });
        const r = await reconcileDelivery({ caller: staff, shipmentId: body.shipmentId, providerInvoiceRef: ref, invoicedCents: Number(body.invoicedCents) }, await deliveryDeps());
        audit({ shipmentId: body.shipmentId, outcome: r.ok ? r.status : r.code, differenceCents: r.ok ? r.differenceCents : null, duplicate: r.ok ? r.duplicate : null });
        if (!r.ok) return refusal(r);
        await flush();
        return NextResponse.json(r);
      }

      case 'close_review': {
        // A leg under review, lost, damaged or returning to the sender is closed by a person,
        // with a reason, through the core transition rules (staff only, reason required).
        if (!isId(body.shipmentId) || !REVIEW_TARGETS.includes(body.to as (typeof REVIEW_TARGETS)[number])) return NextResponse.json({ error: 'Choose the delivery and how the review ends.' }, { status: 400 });
        const reason = text(body.reason, 500);
        // Closing an outbound leg as delivered is a staff decision that the renter has the gear
        // (confirmReceived): it records the decision per item and earns the fee once.
        const r = await closeDeliveryReview(
          { caller: staff, shipmentId: body.shipmentId, to: body.to as (typeof REVIEW_TARGETS)[number], reason, refundFee: body.refundFee === true, confirmReceived: body.confirmReceived === true },
          await deliveryDeps(),
        );
        audit({ shipmentId: body.shipmentId, to: String(body.to), refundFee: body.refundFee === true, confirmReceived: body.confirmReceived === true, outcome: r.ok ? r.outcome : r.code, refundCents: r.ok ? r.refundCents : null });
        if (!r.ok) return refusal(r);
        await flush();
        return NextResponse.json(r);
      }

      case 'dispatch_manual_paid': {
        // F-2 / F-3 (D-50): a delivery paid by hand. The order's own manual payment (an EFT
        // order: its linked quotes, its recorded delivery total), or a return pickup the renter
        // requested during the hire (that quote, the payment staff just took). The core checks
        // the order is confirmed, the quotes are the renter's and the amount is exact; it never
        // dispatches an unpaid leg.
        if (!isId(body.bookingGroupId)) return NextResponse.json({ error: 'Choose the booking.' }, { status: 400 });
        const deps = await deliveryDeps();
        const group = await deps.bookings.getGroup(body.bookingGroupId);
        if (!group) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
        const quoteIds = Array.isArray(body.quoteIds) ? body.quoteIds.filter(isId).slice(0, 4) : [];
        let reference: string;
        let receivedCents: number;
        let ids: string[];
        if (quoteIds.length > 0) {
          const method = MANUAL_METHODS.find((m) => m === body.method);
          const ref = text(body.reference, 60);
          if (!method || ref.length < 2) return NextResponse.json({ error: 'Record how it was paid and its reference.' }, { status: 400 });
          if (!Number.isSafeInteger(body.receivedCents)) return NextResponse.json({ error: 'Enter the amount received in cents.' }, { status: 400 });
          reference = manualReference(method, ref);
          receivedCents = body.receivedCents as number;
          ids = quoteIds;
        } else {
          // The order paid by hand at checkout: its own recorded payment and delivery total.
          if (!group.manualPaymentReference) return NextResponse.json({ error: 'This order was not paid by hand. Record its payment with "Mark paid" first.', code: 'payment_not_confirmed' }, { status: 409 });
          const db = createAdminClient();
          const { data: rows, error } = await db.from('equipment_bookings').select('delivery_fee').eq('checkout_group_id', body.bookingGroupId);
          if (error) return NextResponse.json({ error: 'Could not read the order just now.' }, { status: 503 });
          receivedCents = ((rows ?? []) as { delivery_fee: number | null }[]).reduce((n, r) => n + toCents(Number(r.delivery_fee ?? 0)), 0);
          ids = (await new SupabaseQuoteLinks(db).quotesForGroup(body.bookingGroupId)).filter((q) => q.status === 'active' || q.status === 'expired').map((q) => q.id);
          reference = group.manualPaymentReference;
        }
        const r = await dispatchAfterManualPayment({ staffId: auth.user.id, bookingGroupId: body.bookingGroupId, quoteIds: ids, reference, receivedCents }, deps);
        audit({ bookingGroupId: body.bookingGroupId, quotes: ids.length, receivedCents, outcome: r.ok ? `marked_${r.marked}` : r.code, legs: r.ok ? r.legs.map((l) => `${l.leg}:${l.result}`).join(',') : null });
        if (!r.ok) return refusal(r);
        await flush();
        return NextResponse.json(r);
      }

      case 'quote_leg': {
        // Staff obtain a quote for a renter (e.g. a return pickup arranged by phone). The renter
        // is told a quote is ready; they pay for it through checkout, never here.
        const leg = body.leg === 'outbound' ? 'outbound' : body.leg === 'return' ? 'return' : null;
        if (!isId(body.bookingGroupId) || !leg) return NextResponse.json({ error: 'Choose the booking and the leg.' }, { status: 400 });
        const deps = await deliveryDeps();
        // Phase 8: an order with several origins names the trip (originOwnerId: an owner's id, or null for the studio).
        const origin = body.originOwnerId === null ? null : isId(body.originOwnerId) ? body.originOwnerId : undefined;
        const inputs = await legInputsFor(deps, body.bookingGroupId, leg, origin);
        if (!inputs.ok) return NextResponse.json({ error: inputs.message, code: inputs.code }, { status: inputs.code === 'not_found' ? 404 : 409 });
        const window = sastDayWindow(typeof body.date === 'string' ? body.date : inputs.defaultDate);
        if (!window) return NextResponse.json({ error: 'Choose the date (YYYY-MM-DD).' }, { status: 400 });
        // Advisory: stored without the order link, so it never joins the order's checkout
        // payment; it is tied to the order when its own payment is recorded (dispatch_manual_paid).
        const r = await quoteDelivery(
          { caller: staff, renterId: inputs.renterId, bookingGroupId: body.bookingGroupId, leg, originAddressId: inputs.originAddressId, destinationAddressId: inputs.destinationAddressId, originOwnerId: inputs.originOwnerId, lines: inputs.lines, window, link: false },
          deps,
        );
        if (!r.ok) {
          audit({ bookingGroupId: body.bookingGroupId, leg, outcome: r.code });
          return NextResponse.json({ error: r.message, code: r.code, excluded: r.excluded ?? [] }, { status: 409 });
        }
        const best = r.quotes[0];
        await deps.repo.post([], quoteReadyNotices(inputs.renterId, best));
        audit({ bookingGroupId: body.bookingGroupId, leg, outcome: 'quoted', quotes: r.quotes.length });
        await flush();
        return NextResponse.json({
          ok: true,
          quotes: r.quotes.map((q) => ({ id: q.id, providerId: q.providerId, providerKind: q.providerKind, customerFeeCents: q.customerFeeCents, providerCostCents: q.providerCostCents, expiresAt: q.expiresAt })),
          excluded: r.excluded,
        });
      }

      case 'requeue_event': {
        if (!isId(body.id)) return NextResponse.json({ error: 'Choose the event.' }, { status: 400 });
        const db = createAdminClient();
        const { data, error } = await db
          .from('delivery_provider_events')
          .update({ processing_status: 'received', next_attempt_at: new Date().toISOString(), retry_count: 0, last_error: null })
          .eq('id', body.id)
          .in('processing_status', ['failed', 'dead'])
          .select('id');
        if (error) return NextResponse.json({ error: 'Could not requeue.' }, { status: 500 });
        if (!data?.length) return NextResponse.json({ error: 'Only failed or dead events can be requeued.' }, { status: 409 });
        const result = await drainDeliveryInbox({ store: new SupabaseDeliveryInbox(db), useCases: await deliveryDeps() }, 5, DELIVERY_OPS.inboxMaxRetries);
        audit({ eventId: body.id, claimed: result.claimed });
        await flush();
        return NextResponse.json({ ok: true, result });
      }

      case 'run_jobs': {
        // Re-drive the provider inbox, reconcile unknown dispatches, poll courier legs and
        // remind / deem acceptance of delivered legs now.
        const db = createAdminClient();
        const deps = await deliveryDeps();
        const jobs = new SupabaseDeliveryJobQueries(db);
        const inbox = await drainDeliveryInbox({ store: new SupabaseDeliveryInbox(db), useCases: deps }, DELIVERY_OPS.inboxBatchSize, DELIVERY_OPS.inboxMaxRetries);
        const reconcile = await reconcileUncertainDispatches(deps, jobs);
        const poll = await pollTrackedShipments(deps, jobs);
        const acceptance = await deemDeliveryAcceptances(deps, jobs);
        audit({ inboxClaimed: inbox.claimed, reconciled: reconcile.checked, polled: poll.checked, acceptance: acceptance.checked });
        await flush();
        return NextResponse.json({ ok: true, inbox, reconcile, poll, acceptance });
      }

      case 'reveal_address': {
        // For dispatch only. The reveal is logged (ids only); the address is never in lists.
        const side = body.side === 'origin' ? 'origin' : body.side === 'destination' ? 'destination' : null;
        if (!isId(body.shipmentId) || !side) return NextResponse.json({ error: 'Choose the delivery and which address.' }, { status: 400 });
        const found = await revealShipmentAddress(createAdminClient(), body.shipmentId, side);
        audit({ shipmentId: body.shipmentId, side, addressId: found?.addressId ?? null, outcome: found ? 'revealed' : 'not_found' });
        if (!found) return NextResponse.json({ error: 'Address not found.' }, { status: 404 });
        return NextResponse.json({ ok: true, side, address: found.address, trackingUrl: found.trackingUrl }, { headers: { 'Cache-Control': 'no-store' } });
      }

      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (err) {
    console.error(`[admin-delivery] ${action} failed:`, err instanceof Error ? err.message : 'unknown');
    audit({ outcome: 'error' });
    return NextResponse.json({ error: 'The action could not be completed. Reload to see the current state before trying again.' }, { status: 500 });
  }
}
