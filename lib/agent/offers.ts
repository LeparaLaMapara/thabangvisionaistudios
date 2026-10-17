import { newServiceBookingReference } from '@/lib/payments/booking-reference';
import { STUDIO } from '@/lib/constants';
import { createAdminClient } from '@/lib/supabase/server';
import { payments } from '@/lib/payments';
import { email as emailProvider } from '@/lib/email';
import { reportUnpaidRequest, PAYMENTS_OFF_MESSAGE } from '@/lib/payments/offline';
import { getHourlyRate, mentionsFulfilmentSchema, withoutFulfilmentColumns } from '@/lib/supabase/queries/service-bookings';
import { revisionPolicyText } from '@/lib/core/services/fulfilment';
import { quoteHourly, quotePackage, splitServiceBooking } from '@/lib/bookings/pricing';
import { getBookablePackage } from '@/lib/bookings/packages';
import { addToCart } from '@/lib/supabase/queries/cart';
import { calculateCartPricing } from '@/lib/cart/pricing';
import { itemValue } from '@/lib/rental/protection';
import { availabilityFor } from '@/lib/rental/availability-server';
import { checkRenterEligibility } from '@/lib/rental/eligibility-server';
import { meetsLeadTime, leadTimeMessage } from '@/lib/rental/leadTime';
import { toCents } from '@/lib/core/pricing/money';
import { logEvent } from '@/lib/data/events';
import type { AgentActionKind } from '@/lib/core/agent/approval';
import type { ApprovalSummary, Execute, Requote } from '@/lib/core/agent/use-cases';
import type { CartItemWithRental } from '@/types/cart';
import { appUrl } from '@/lib/app-url';
import { planExecute, planMoveExecute, planMoveRequote, planRequote } from '@/lib/projects/agent';

/**
 * Server-side quotes and execution for Ubunye proposals. Prices come from the
 * same functions the website charges by; the model's numbers are never used.
 * Execution goes through the website's own steps: a gear proposal becomes a
 * cart line (the customer pays at checkout, which re-checks stock, limits and
 * price); a service proposal becomes a service booking with a payment link.
 */

type Admin = ReturnType<typeof createAdminClient>;
const admin = (): Admin => createAdminClient();

const rands = (cents: number): string => `R${(cents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function daysBetween(start: string, end: string): number {
  return Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000);
}

export function gearCancellationPolicy(): string {
  const tiers = STUDIO.rental.cancellationTiers;
  const parts = tiers.map((t, i) => {
    const prev = tiers[i - 1];
    const when = i === 0 ? `${t.minHoursBefore}+ hours before the start` : `${t.minHoursBefore}–${prev.minHoursBefore} hours before`;
    return `${when}: ${t.refundPercent}% of the hire back`;
  });
  return `${parts.join('; ')}. The deposit is always refunded when you cancel before collection.`;
}

// ── Gear ─────────────────────────────────────────────────────────────────────

export interface GearPayload {
  rental_id: string;
  start_date: string;
  end_date: string;
  quantity: number;
}

interface RentalRow {
  id: string;
  title: string;
  brand: string | null;
  model: string | null;
  quantity: number | null;
  is_available: boolean | null;
  price_per_day: number;
  price_per_week: number | null;
  deposit_amount: number | null;
  replacement_value: number | null;
}

async function loadRental(id: string): Promise<RentalRow | null> {
  const { data, error } = await admin()
    .from('smart_rentals')
    .select('id, title, brand, model, quantity, is_available, price_per_day, price_per_week, deposit_amount, replacement_value')
    .eq('id', id)
    .eq('is_published', true)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error('rental lookup failed');
  return (data as RentalRow | null) ?? null;
}

function priceGear(r: RentalRow, p: GearPayload): { hireCents: number; depositCents: number; totalCents: number; days: number } {
  const days = daysBetween(p.start_date, p.end_date);
  const item = {
    rental_id: r.id,
    quantity: p.quantity,
    rental: { title: r.title, price_per_day: r.price_per_day, price_per_week: r.price_per_week, deposit_amount: r.deposit_amount, replacement_value: r.replacement_value },
  } as unknown as CartItemWithRental;
  const pricing = calculateCartPricing([item], days);
  const hireCents = toCents(pricing.subtotal - pricing.bulkDiscountAmount);
  const depositCents = toCents(pricing.totalDeposit);
  return { hireCents, depositCents, totalCents: hireCents + depositCents, days };
}

async function checkGear(p: GearPayload, now: Date): Promise<{ ok: true; rental: RentalRow } | { ok: false; message: string }> {
  if (!ISO.test(p.start_date) || !ISO.test(p.end_date) || p.end_date <= p.start_date) {
    return { ok: false, message: 'Use two dates, YYYY-MM-DD, with the return day after the first hire day.' };
  }
  if (!meetsLeadTime(p.start_date, now)) return { ok: false, message: leadTimeMessage(now) };
  const rental = await loadRental(p.rental_id);
  if (!rental || !rental.is_available) return { ok: false, message: 'That item is not available to rent.' };
  if (!Number.isSafeInteger(p.quantity) || p.quantity < 1 || p.quantity > (rental.quantity ?? 1)) {
    return { ok: false, message: 'That quantity is not available.' };
  }
  const free = (await availabilityFor({ rentalId: p.rental_id, stock: rental.quantity, startDate: p.start_date, endDate: p.end_date, requested: p.quantity })).available;
  if (!free) return { ok: false, message: `${rental.title} is already booked for those dates.` };
  return { ok: true, rental };
}

/** Prepare a gear proposal: availability, the renter's limit and the server price. */
export async function prepareGear(
  user: { id: string; email_confirmed_at?: string | null },
  input: { rental_id: string; start_date: string; end_date: string; quantity?: number },
  now: Date = new Date(),
): Promise<{ ok: true; payload: GearPayload; summary: ApprovalSummary } | { ok: false; message: string }> {
  const payload: GearPayload = {
    rental_id: String(input.rental_id),
    start_date: String(input.start_date),
    end_date: String(input.end_date),
    quantity: Math.max(1, Math.floor(Number(input.quantity ?? 1)) || 1),
  };
  const c = await checkGear(payload, now);
  if (!c.ok) return c;
  const unitValue = toCents(itemValue(c.rental));
  const eligibility = await checkRenterEligibility(admin(), user, [{ unitReplacementValueCents: unitValue, quantity: payload.quantity, startDate: payload.start_date, endDate: payload.end_date }], false, now);
  if (!eligibility.ok) return { ok: false, message: eligibility.message };
  const price = priceGear(c.rental, payload);
  const collection = eligibility.collectionRequired
    ? eligibility.collectionReasons.includes('first_hire')
      ? 'Collected in person: your first hire is checked with you at the counter.'
      : 'Collected in person: high-value items are always collected.'
    : null;
  return {
    ok: true,
    payload,
    summary: {
      title: payload.quantity > 1 ? `${c.rental.title} × ${payload.quantity}` : c.rental.title,
      details: [
        ...(c.rental.brand || c.rental.model ? [`Make: ${clip([c.rental.brand, c.rental.model].filter(Boolean).join(' '), 80)}`] : []),
        `Quantity: ${payload.quantity}`,
      ],
      period: `${payload.start_date} to ${payload.end_date} (${price.days} day${price.days === 1 ? '' : 's'})`,
      lines: [{ label: 'Hire', amountCents: price.hireCents }],
      depositCents: price.depositCents,
      totalCents: price.totalCents,
      collection,
      cancellationPolicy: gearCancellationPolicy(),
      nextStep: 'Approving adds it to your cart. You pay at checkout, which shows the final total with anything else in your cart and holds the gear once paid.',
    },
  };
}

// ── Services ─────────────────────────────────────────────────────────────────

export interface ServicePayload {
  creator_id: string | null;
  project_category: string;
  project_description: string;
  deliverables: string;
  duration_hours: number;
  location: string | null;
  preferred_dates: string | null;
  package_id: string | null;
}

/** A named creator must exist, be ID-verified and be taking bookings. */
async function checkCreator(creatorId: string | null): Promise<{ ok: true; name: string | null } | { ok: false; message: string }> {
  if (!creatorId) return { ok: true, name: null };
  const { data, error } = await admin().from('profiles').select('display_name, verification_status, available_for_hire, is_suspended').eq('id', creatorId).maybeSingle();
  if (error) throw new Error('creator lookup failed');
  const c = data as { display_name?: string | null; verification_status?: string | null; available_for_hire?: boolean | null; is_suspended?: boolean | null } | null;
  if (!c || c.verification_status !== 'verified' || c.available_for_hire === false || c.is_suspended) {
    return { ok: false, message: 'That creator cannot be booked right now. Suggest another creator or let our team assign one.' };
  }
  return { ok: true, name: c.display_name ? clip(c.display_name, 80) : null };
}

/** One line of user-typed text for the approval card (React escapes it; this keeps it short). */
function clip(v: string, max: number): string {
  const t = v.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

async function quoteService(p: ServicePayload): Promise<{ ok: true; subtotal: number; vat: number; total: number; category: string; hours: number; creatorId: string | null; creatorName: string | null; packageTitle: string | null } | { ok: false; message: string }> {
  const pkg = p.package_id ? await getBookablePackage(admin(), p.package_id) : null;
  if (p.package_id && !pkg) return { ok: false, message: 'That package is not available to book.' };
  const category = pkg ? pkg.title : p.project_category;
  const hours = pkg && pkg.priceUnit !== 'hour' ? pkg.hours ?? STUDIO.booking.minBookingHours : p.duration_hours;
  if (!Number.isFinite(hours) || hours < STUDIO.booking.minBookingHours || hours > STUDIO.booking.maxBookingHours) {
    return { ok: false, message: `Duration must be between ${STUDIO.booking.minBookingHours} and ${STUDIO.booking.maxBookingHours} hours.` };
  }
  const creator = await checkCreator(pkg?.creatorId ?? p.creator_id);
  if (!creator.ok) return creator;
  const q = pkg
    ? quotePackage(pkg.price, pkg.priceUnit, hours, STUDIO.booking.vatRate)
    : quoteHourly(getHourlyRate(category), hours, STUDIO.booking.vatRate);
  return { ok: true, subtotal: q.subtotal, vat: q.vat, total: q.total, category, hours, creatorId: pkg?.creatorId ?? p.creator_id, creatorName: creator.name, packageTitle: pkg?.title ?? null };
}

export async function prepareService(
  user: { id: string },
  input: Record<string, unknown>,
): Promise<{ ok: true; payload: ServicePayload; summary: ApprovalSummary } | { ok: false; message: string }> {
  const payload: ServicePayload = {
    creator_id: typeof input.creator_id === 'string' && input.creator_id ? input.creator_id : null,
    project_category: String(input.project_category ?? '').slice(0, 120),
    project_description: String(input.project_description ?? '').slice(0, 4000),
    deliverables: String(input.deliverables ?? '').slice(0, 2000),
    duration_hours: Number(input.duration_hours),
    location: typeof input.location === 'string' ? input.location.slice(0, 200) : null,
    preferred_dates: typeof input.preferred_dates === 'string' ? input.preferred_dates.slice(0, 200) : null,
    package_id: typeof input.package_id === 'string' && input.package_id ? input.package_id : null,
  };
  if (payload.project_description.length < 20) return { ok: false, message: 'Describe the project in at least 20 characters.' };
  if (!payload.deliverables.trim()) return { ok: false, message: 'Say what the client will receive.' };
  if (payload.creator_id && payload.creator_id === user.id) return { ok: false, message: 'You cannot book yourself.' };
  const q = await quoteService(payload);
  if (!q.ok) return q;
  // A package names its own creator: the same rule applies to it.
  if (q.creatorId && q.creatorId === user.id) return { ok: false, message: 'You cannot book yourself.' };
  return {
    ok: true,
    payload: { ...payload, project_category: q.category, duration_hours: q.hours, creator_id: q.creatorId },
    summary: {
      title: q.packageTitle ? `Package: ${q.packageTitle}` : `${q.category} (hourly rate)`,
      // Looked up by the server, so the person sees who they are hiring and
      // what they get, not only the model's wording.
      details: [
        `Creator: ${q.creatorId ? q.creatorName ?? 'Verified creator' : 'Assigned by our team'}`,
        ...(payload.location ? [`Where: ${clip(payload.location, 120)}`] : []),
        `You receive: ${clip(payload.deliverables, 200)}`,
        `Brief: ${clip(payload.project_description, 240)}`,
      ],
      period: `${q.hours} hour${q.hours === 1 ? '' : 's'}${payload.preferred_dates ? `, ${payload.preferred_dates}` : ''}`,
      lines: [
        { label: 'Service', amountCents: toCents(q.subtotal) },
        ...(q.vat > 0 ? [{ label: 'VAT', amountCents: toCents(q.vat) }] : []),
      ],
      depositCents: 0,
      totalCents: toCents(q.total),
      collection: null,
      cancellationPolicy: STUDIO.booking.cancellationPolicy,
      nextStep: 'Approving creates the booking and takes you to payment. It is confirmed once payment is received.',
    },
  };
}

// ── Requote and execute (used by the commit) ─────────────────────────────────

export const requote: Requote = async (kind: AgentActionKind, payload: Record<string, unknown>) => {
  if (kind === 'gear_booking') {
    const p = payload as unknown as GearPayload;
    const c = await checkGear(p, new Date());
    if (!c.ok) return c;
    return { ok: true, amountCents: priceGear(c.rental, p).totalCents };
  }
  // A plan is checked against its owner, so it needs requoteFor (the commit route uses it).
  if (kind === 'project_create' || kind === 'project_update') return { ok: false, message: 'That plan cannot be checked here. Ask Ubunye again.' };
  const q = await quoteService(payload as unknown as ServicePayload);
  return q.ok ? { ok: true, amountCents: toCents(q.total) } : q;
};

/**
 * The requote for one signed-in person. A plan (project_create) re-checks
 * that every booking it points at is still theirs; it always costs 0.
 */
export function requoteFor(userId: string): Requote {
  return async (kind, payload) => (kind === 'project_create' ? planRequote(userId, payload) : kind === 'project_update' ? planMoveRequote(userId, payload) : requote(kind, payload));
}

export function executorFor(user: { id: string; email?: string | null; email_confirmed_at?: string | null }, conversationId: string | null): Execute {
  return async (kind, payload, _userId, approvedAmountCents) => {
    if (kind === 'gear_booking') {
      const p = payload as unknown as GearPayload;
      const c = await checkGear(p, new Date());
      if (!c.ok) return c;
      if (priceGear(c.rental, p).totalCents !== approvedAmountCents) return { ok: false, message: PRICE_MOVED };
      const eligibility = await checkRenterEligibility(admin(), user, [{ unitReplacementValueCents: toCents(itemValue(c.rental)), quantity: p.quantity, startDate: p.start_date, endDate: p.end_date }], false);
      if (!eligibility.ok) return { ok: false, message: eligibility.message };
      const item = await addToCart(user.id, p.rental_id, p.quantity, p.start_date, p.end_date);
      if (!item) return { ok: false, message: 'Could not add it to your cart. Try again.' };
      logEvent({ eventType: 'cart_added', eventCategory: 'booking', userId: user.id, metadata: { rental_id: p.rental_id, start_date: p.start_date, end_date: p.end_date, qty: p.quantity, source: 'ubunye_approved' } });
      return { ok: true, result: { next: '/dashboard/cart', message: `${c.rental.title} is in your cart. Pay at checkout to hold it.` } };
    }
    if (kind === 'project_create') {
      if (approvedAmountCents !== 0) return { ok: false, message: 'A plan costs nothing; this approval does not match.' };
      return planExecute(user.id, payload);
    }
    if (kind === 'project_update') {
      if (approvedAmountCents !== 0) return { ok: false, message: 'Moving a plan costs nothing; this approval does not match.' };
      return planMoveExecute(user.id, payload);
    }
    return createServiceBooking(user, payload as unknown as ServicePayload, conversationId, approvedAmountCents);
  };
}

const PRICE_MOVED = 'The price changed since you approved it, so nothing was booked. Ask Ubunye for a fresh quote.';

/** An ISO date from the client becomes the shoot date; free text ("first week of March") stays null, as on /book. */
function toShootDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return Number.isNaN(new Date(trimmed).getTime()) ? null : trimmed;
}

async function createServiceBooking(
  user: { id: string; email?: string | null },
  p: ServicePayload,
  conversationId: string | null,
  approvedAmountCents: number,
): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; message: string }> {
  const q = await quoteService(p);
  if (!q.ok) return q;
  if (q.creatorId && q.creatorId === user.id) return { ok: false, message: 'You cannot book yourself.' };
  if (toCents(q.total) !== approvedAmountCents) return { ok: false, message: PRICE_MOVED };
  const { platformAmount, creatorAmount } = splitServiceBooking({ subtotal: q.subtotal }, STUDIO.booking.platformCommission);
  const reference = newServiceBookingReference();
  const baseUrl = appUrl(STUDIO.meta.url);
  // The agreed terms are recorded the same way as on the /book form (spec §8.3).
  const revisionsIncluded = STUDIO.booking.defaultRevisionsIncluded;
  const row: Record<string, unknown> = {
      reference,
      client_id: user.id,
      client_email: user.email,
      creator_id: q.creatorId,
      booking_type: 'production',
      project_category: q.category,
      project_description: p.project_description,
      deliverables: p.deliverables,
      duration_hours: q.hours,
      location: p.location,
      preferred_dates: p.preferred_dates,
      subtotal: q.subtotal,
      vat: q.vat,
      total: q.total,
      platform_commission: STUDIO.booking.platformCommission,
      platform_amount: platformAmount,
      creator_amount: creatorAmount,
      status: 'pending',
      payment_status: 'unpaid',
      shoot_date: toShootDate(p.preferred_dates),
      revisions_included: revisionsIncluded,
      revision_policy: revisionPolicyText(revisionsIncluded),
      cancellation_policy: STUDIO.booking.cancellationPolicy,
  };
  const insert = (values: Record<string, unknown>) => admin().from('bookings').insert(values).select('id, reference').single();
  let { data: booking, error } = await insert(row);
  // Before migration 073 the terms columns do not exist yet.
  if (error && mentionsFulfilmentSchema(error.message)) ({ data: booking, error } = await insert(withoutFulfilmentColumns(row)));
  if (error || !booking) return { ok: false, message: 'Could not create the booking. Nothing was charged; try again.' };

  if (!payments.isConfigured()) {
    reportUnpaidRequest({ kind: 'service', reference, userId: user.id, userEmail: user.email ?? undefined, amount: q.total, summary: `${q.category} (via Ubunye)` });
    return { ok: true, result: { booking_reference: reference, payments_offline: true, next: '/dashboard/bookings?payment=offline', message: `Request ${reference} saved. ${PAYMENTS_OFF_MESSAGE}` } };
  }

  const { accessCode } = await payments.createCheckout({
    paymentId: reference,
    amount: q.total,
    itemName: `Booking: ${q.category}`,
    itemDescription: `${q.category} — ${q.hours}hrs`,
    email: user.email ?? '',
    returnUrl: `${baseUrl}/api/service-bookings/callback?reference=${reference}`,
    cancelUrl: `${baseUrl}/dashboard/bookings?status=cancelled&ref=${reference}`,
    metadata: { customStr1: 'service_booking', customStr2: (booking as { id: string }).id },
  });
  // Not needed to confirm the payment (the webhook finds the booking by `reference`): log a failure, keep the link.
  const { error: refError } = await admin().from('bookings').update({ paystack_reference: reference, paystack_access_code: accessCode || null }).eq('id', (booking as { id: string }).id);
  if (refError) console.error('[agent/offers] Could not save the payment reference:', reference, refError.message);

  try {
    await emailProvider.sendEmail({
      to: STUDIO.bookingEmail,
      subject: `New booking: ${q.category} — ${reference}`,
      text: `A service booking was approved by the client in Ubunye.\n\nReference: ${reference}\nCategory: ${q.category}\nDuration: ${q.hours} hours\nTotal: ${rands(toCents(q.total))}\nCreator: ${q.creatorId ?? 'Unassigned'}\n\nView in admin: ${baseUrl}/admin/service-bookings`,
    });
  } catch {
    /* the booking stands without the email */
  }
  logEvent({ eventType: 'booking_created', eventCategory: 'booking', userId: user.id, metadata: { reference, project_category: q.category, duration_hours: q.hours, total: q.total, has_creator: Boolean(q.creatorId), source: 'ubunye_approved', conversation: conversationId } });
  return {
    ok: true,
    result: {
      booking_reference: reference,
      next: `/dashboard/bookings/pay?ref=${encodeURIComponent(reference)}`,
      message: `Booking ${reference} created. It is confirmed once payment is received.`,
    },
  };
}
