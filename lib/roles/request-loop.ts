import { ROLES_POLICY, STUDIO } from '@/lib/constants';
import { bankDetailsText, paymentReference, BANK_DETAILS_NEVER_CHANGE } from '@/lib/payments/eft';
import { vatOnInclusive, vatRateAt } from '@/lib/core/pricing/tax';
import { formatRands, unitLabel } from './pricing';
import type { PersonRole, PricingUnit } from './types';
import type { RequestStatus } from './reveal';

/**
 * The People request loop, in words (migration 095). Pure and browser-safe,
 * so every message is tested (tests/unit/people-loop.test.ts).
 *
 * What the code can do today, and so what we say:
 *   1. A client sends a request. Nothing is paid. The owner, the person asked
 *      and the client are emailed.
 *   2. Staff check the date with the person and answer: accepted or declined.
 *   3. Accepted: the client pays by EFT to the business account, with a
 *      reference. Online card payment for People is not built.
 *   4. Staff see the money arrive and mark it paid: 'confirmed'. Only then do
 *      the client and the person see each other (lib/roles/reveal.ts).
 * The person is paid by hand by our team after the job (no payout code for
 * People). Nothing here promises held payment, refunds or replacements.
 */

export type Viewer = 'client' | 'person';

export interface EmailText {
  subject: string;
  text: string;
}

const NAME = STUDIO.shortName;
const REPLY_DAYS = ROLES_POLICY.requests.replyWithinWorkingDays;
const replyWithin = `${REPLY_DAYS} working day${REPLY_DAYS === 1 ? '' : 's'}`;
const PAY_HOURS = STUDIO.bank.payWithinHours;

/** The one line a client reads before and after sending: what happens next, and how they pay. */
export const REQUEST_NEXT_STEPS: readonly string[] = [
  `Nothing is paid now. We check the date with them and email you within ${replyWithin}.`,
  `If they can do it, you pay by EFT to our business account. We email you the amount and your reference.`,
  'Your booking is confirmed once your payment shows. Then you see who is coming.',
];

/** The request reference: the same on the client's EFT, the request page and the admin list. */
export function requestReference(requestId: string): string {
  return paymentReference(requestId);
}

// ─── Status, in plain words ────────────────────────────────────────────────

/** A short label for a list (dashboard Hires, the admin list). */
export function requestStatusLabel(status: RequestStatus, viewer: Viewer = 'client'): string {
  switch (status) {
    case 'requested':
      return viewer === 'client' ? 'Waiting for an answer' : 'New request';
    case 'accepted':
      return viewer === 'client' ? 'They can do it: pay to confirm' : 'Waiting for the client to pay';
    case 'confirmed':
      return 'Booked';
    case 'completed':
      return 'Done';
    case 'declined':
      return 'Not going ahead';
    case 'withdrawn':
      return 'Cancelled';
    default:
      return 'Waiting for an answer';
  }
}

/** The sentence under the heading on /people/requests/[rid]. */
export function requestStatusWords(status: RequestStatus, viewer: Viewer): string {
  if (viewer === 'person') {
    switch (status) {
      case 'requested':
        return `A client asked for you. Can you do it? Reply to our email with yes or no, or WhatsApp us. Nothing is paid yet.`;
      case 'accepted':
        return 'You said yes. We are waiting for the client to pay. We tell you as soon as the booking is confirmed.';
      case 'confirmed':
        return 'Booked and paid. The address and the client’s first name are below.';
      case 'completed':
        return 'Done. Thank you.';
      case 'declined':
        return 'This one is not going ahead.';
      case 'withdrawn':
        return 'The client cancelled this request.';
      default:
        return '';
    }
  }
  switch (status) {
    case 'requested':
      return REQUEST_NEXT_STEPS.join(' ');
    case 'accepted':
      return `They can do it. Pay by EFT within ${PAY_HOURS} hours to confirm, using the details below. Your booking is confirmed once your payment shows.`;
    case 'confirmed':
      return 'Booked and paid. Here is who is coming.';
    case 'completed':
      return 'Done. Thank you for booking with us.';
    case 'declined':
      return 'They cannot do this one. Nothing was paid. You can choose someone else on People.';
    case 'withdrawn':
      return 'You cancelled this request. Nothing was paid.';
    default:
      return '';
  }
}

/** The heading on the request page: an unconfirmed request is never called a booking. */
export function requestHeading(status: RequestStatus, viewer: Viewer): string {
  const booked = status === 'confirmed' || status === 'completed';
  if (viewer === 'person') return booked ? 'Your job' : 'A request for you';
  return booked ? 'Your booking' : 'Your request';
}

/** Bank details and the reference: shown to the client only once the request is accepted. */
export function showPaymentDetails(status: RequestStatus, viewer: Viewer): boolean {
  return viewer === 'client' && status === 'accepted';
}

// ─── What the person earns ─────────────────────────────────────────────────

export interface Earnings {
  /** What the client pays (the price on the profile, VAT included if any). */
  clientPaysCents: number;
  /** Our cut: commission on the price before VAT. */
  cutCents: number;
  /** What the person gets. */
  youGetCents: number;
  percent: number;
}

/**
 * The person's share of a price, by the same rule as service bookings
 * (lib/bookings/pricing.ts splitServiceBooking): the commission is taken
 * from the price before VAT, and VAT is never part of the person's share.
 */
export function personEarnings(priceCents: number, at: Date = new Date()): Earnings {
  const gross = Math.max(0, Math.round(priceCents));
  const net = gross - vatOnInclusive(gross, vatRateAt(at));
  const percent = STUDIO.creators.commissionRate;
  const cutCents = Math.round((net * percent) / 100);
  return { clientPaysCents: gross, cutCents, youGetCents: net - cutCents, percent };
}

/** "Clients see and pay R1 500 per day. You get R1 275 per day ..." */
export function earningsLine(unit: PricingUnit, priceCents: number, at: Date = new Date()): string {
  const e = personEarnings(priceCents, at);
  const per = unitLabel(unit);
  return `Clients see and pay ${formatRands(e.clientPaysCents)} ${per}. You get ${formatRands(e.youGetCents)} ${per}: ${NAME} keeps ${e.percent}% of the price before VAT.`;
}

/** When and how the person is paid: only what is true today (paid by hand, no payout run for People). */
export const PERSON_PAYOUT_LINE =
  'We pay you by bank transfer, by hand, after the job is done and the client has paid. Add your bank account under Payouts in your dashboard.';

/** How the price works, before they send their profile. */
export const PRICE_MEANING_LINE =
  'This is the full price clients see and pay. Nothing is added on top for them.';

// ─── The Offer status screen (a person who already sent their profile) ─────

export type IdentityState = 'verified' | 'pending' | 'rejected' | 'none';

export function identityState(verificationStatus: string | null | undefined): IdentityState {
  if (verificationStatus === 'verified') return 'verified';
  if (verificationStatus === 'pending') return 'pending';
  if (verificationStatus === 'rejected') return 'rejected';
  return 'none';
}

export const ID_CHECK_HREF = '/dashboard/verification';

/** The ID check line: we only approve a profile once it has passed (app/api/admin/roles approve). */
export function idCheckLine(state: IdentityState): { text: string; action: { label: string; href: string } | null } {
  switch (state) {
    case 'verified':
      return { text: 'Your ID check is done.', action: null };
    case 'pending':
      return { text: `Your ID check is with our team. We approve your profile once it passes.`, action: null };
    case 'rejected':
      return { text: 'Your ID check needs another try. We can only approve your profile once it passes.', action: { label: 'Try the ID check again', href: ID_CHECK_HREF } };
    default:
      return { text: 'One more step: your ID check. We approve your profile only once it passes. It takes about two minutes.', action: { label: 'Do my ID check', href: ID_CHECK_HREF } };
  }
}

/** Which sent profile /offer shows: one needing a change, then one in review, then a live one. Null: show the form. */
const SENT_ORDER: PersonRole['status'][] = ['changes_requested', 'submitted', 'approved'];

export function profileToShow<T extends Pick<PersonRole, 'status' | 'role_slug'>>(mine: T[], roleSlug: string | null): T | null {
  if (roleSlug) {
    const forRole = mine.find((p) => p.role_slug === roleSlug);
    return forRole && SENT_ORDER.includes(forRole.status) ? forRole : null;
  }
  return [...mine].filter((p) => SENT_ORDER.includes(p.status)).sort((a, b) => SENT_ORDER.indexOf(a.status) - SENT_ORDER.indexOf(b.status))[0] ?? null;
}

export interface OfferStatusInput {
  status: 'draft' | 'submitted' | 'approved' | 'changes_requested';
  reviewerNote: string | null;
  personRoleId: string;
  roleName: string;
  identity: IdentityState;
}

export interface OfferStatusView {
  kind: 'review' | 'live' | 'sent_back';
  title: string;
  lines: string[];
  note: string | null;
  primary: { label: string; href: string } | null;
  idCheck: { text: string; action: { label: string; href: string } | null };
}

/** null: still a draft, so the form shows. Otherwise the status screen. */
export function offerStatusView(i: OfferStatusInput): OfferStatusView | null {
  const idCheck = idCheckLine(i.identity);
  if (i.status === 'submitted') {
    return {
      kind: 'review',
      title: 'With our team',
      lines: [`We check your ${i.roleName.toLowerCase()} profile within 2 working days and email you the answer.`],
      note: null,
      primary: null,
      idCheck,
    };
  }
  if (i.status === 'approved') {
    return {
      kind: 'live',
      title: 'Approved: your profile is live',
      lines: ['Clients can find you on People and ask to book you. We email you when someone asks.'],
      note: null,
      primary: { label: 'See your profile', href: `/people/${i.personRoleId}` },
      idCheck,
    };
  }
  if (i.status === 'changes_requested') {
    return {
      kind: 'sent_back',
      title: 'Sent back: here is what to change',
      lines: ['Make the change, then send it again. We look at it again within 2 working days.'],
      note: i.reviewerNote?.trim() || null,
      primary: null,
      idCheck,
    };
  }
  return null;
}

// ─── Emails ────────────────────────────────────────────────────────────────

export interface RequestFacts {
  requestId: string;
  roleName: string;
  /** "Make-up artist in Soweto": the blind label, never a name. */
  personLabel: string;
  /** Every day asked for (YYYY-MM-DD). */
  dates: string[];
  arrival: string;
  durationHours: number;
  area: string;
  totalCents: number | null;
}

function datesText(dates: string[]): string {
  return dates.length ? dates.join(', ') : 'to be agreed';
}

function hoursText(h: number): string {
  return `${h} hour${h === 1 ? '' : 's'}`;
}

function whenLines(f: RequestFacts): string[] {
  return [
    `What: ${f.roleName}`,
    `When: ${datesText(f.dates)}, arriving ${f.arrival}, ${hoursText(f.durationHours)}${f.dates.length > 1 ? ' each day' : ''}`,
    `Area: ${f.area}`,
  ];
}

/** To the owner: everything, so they can answer at once. */
export function ownerNewRequestEmail(
  f: RequestFacts & {
    client: { name: string | null; email: string | null };
    person: { name: string | null; email: string | null };
    address: string | null;
    note: string | null;
  },
  baseUrl: string,
): EmailText {
  return {
    subject: `[People request] ${f.roleName}, ${datesText(f.dates)}, ${f.area}`,
    text: [
      'Someone asked to book a person on People. Nothing has been paid.',
      '',
      ...whenLines(f),
      ...(f.address ? [`Address: ${f.address}`] : []),
      ...(f.note ? [`Note from the client: ${f.note}`] : []),
      `Total: ${f.totalCents === null ? 'not worked out' : formatRands(f.totalCents)}`,
      `Reference: ${requestReference(f.requestId)}`,
      '',
      `Client: ${f.client.name ?? '(no name)'}, ${f.client.email ?? '(no email)'}`,
      `Person asked: ${f.personLabel}, ${f.person.name ?? '(no name)'}, ${f.person.email ?? '(no email)'}`,
      '',
      `They have also been emailed. Check the date with them, then answer the client within ${replyWithin}:`,
      `${baseUrl}/admin/roles/requests`,
    ].join('\n'),
  };
}

/**
 * To the person asked. Blind, as the request page is: no client name, email,
 * phone, address or free-text note before the booking is confirmed.
 */
export function personNewRequestEmail(f: RequestFacts, baseUrl: string, at: Date = new Date()): EmailText {
  const earn = f.totalCents === null ? null : personEarnings(f.totalCents, at);
  return {
    subject: `New request: ${f.roleName} on ${f.dates[0] ?? 'a date to agree'} (${NAME})`,
    text: [
      'Hi,',
      '',
      'A client asked to book you through People.',
      '',
      ...whenLines(f),
      ...(earn ? [`You get: ${formatRands(earn.youGetCents)} (the client pays ${formatRands(earn.clientPaysCents)}; we keep ${earn.percent}% of the price before VAT)`] : []),
      '',
      'Can you do it? Reply to this email with yes or no, or WhatsApp us.',
      'Nothing is paid yet. When you say yes, the client pays us. Once the payment shows, the booking is confirmed and you see the address and the client’s first name.',
      PERSON_PAYOUT_LINE,
      '',
      `See the request: ${baseUrl}/people/requests/${f.requestId}`,
    ].join('\n'),
  };
}

/** To the client, straight after sending: what happens next, when, and how they pay. */
export function clientRequestReceivedEmail(f: RequestFacts, baseUrl: string): EmailText {
  return {
    subject: `We got your request (${NAME})`,
    text: [
      'Hi,',
      '',
      'Thank you. We got your request.',
      '',
      `Who: ${f.personLabel}`,
      ...whenLines(f).slice(1),
      ...(f.totalCents !== null ? [`Total: ${formatRands(f.totalCents)}`] : []),
      '',
      'What happens next:',
      ...REQUEST_NEXT_STEPS.map((s, n) => `${n + 1}. ${s}`),
      '',
      `See your request: ${baseUrl}/people/requests/${f.requestId}`,
    ].join('\n'),
  };
}

/** To the client when staff accept: pay by EFT, with the reference. */
export function clientAcceptedEmail(f: RequestFacts, baseUrl: string): EmailText {
  const ref = requestReference(f.requestId);
  return {
    subject: `They can do it: pay to confirm (${NAME})`,
    text: [
      'Hi,',
      '',
      `Good news: ${f.personLabel} can do your request.`,
      '',
      ...whenLines(f).slice(1),
      '',
      `To confirm, pay ${f.totalCents === null ? 'the total on your request page' : formatRands(f.totalCents)} by EFT within ${PAY_HOURS} hours:`,
      bankDetailsText(ref),
      '',
      'Your booking is confirmed once your payment shows. We email you then, and you see who is coming.',
      BANK_DETAILS_NEVER_CHANGE,
      '',
      `See your request: ${baseUrl}/people/requests/${f.requestId}`,
    ].join('\n'),
  };
}

/** To the client when staff decline. */
export function clientDeclinedEmail(f: RequestFacts, baseUrl: string, note: string | null): EmailText {
  return {
    subject: `Your request is not going ahead (${NAME})`,
    text: [
      'Hi,',
      '',
      `Sorry: ${f.personLabel} cannot do your request for ${datesText(f.dates)}.`,
      ...(note ? ['', note] : []),
      '',
      'Nothing was paid. You can choose someone else on People:',
      `${baseUrl}/people`,
    ].join('\n'),
  };
}

/** To the client and the person when staff mark the payment received. */
export function confirmedEmail(f: RequestFacts, baseUrl: string, viewer: Viewer): EmailText {
  return {
    subject: `Booked: ${f.roleName} on ${f.dates[0] ?? 'your date'} (${NAME})`,
    text: [
      'Hi,',
      '',
      viewer === 'client'
        ? 'Your payment has come in. Your booking is confirmed.'
        : 'The client has paid. The booking is confirmed. The address and the client’s first name are on the job page.',
      '',
      ...whenLines(f),
      '',
      viewer === 'client' ? `See who is coming: ${baseUrl}/people/requests/${f.requestId}` : `See the job: ${baseUrl}/people/requests/${f.requestId}`,
      ...(viewer === 'person' ? ['', PERSON_PAYOUT_LINE] : []),
    ].join('\n'),
  };
}

/** To the person when a request they were told about will not go ahead. */
export function personClosedEmail(f: RequestFacts, baseUrl: string): EmailText {
  return {
    subject: `Request closed: ${f.roleName} on ${f.dates[0] ?? 'the date asked'} (${NAME})`,
    text: [
      'Hi,',
      '',
      `The request for ${datesText(f.dates)} in ${f.area} is not going ahead. You do not need to do anything.`,
      '',
      `${baseUrl}/people/requests/${f.requestId}`,
    ].join('\n'),
  };
}

// ─── Profile decisions, to the person offering ─────────────────────────────

export function profileApprovedEmail(roleName: string, personRoleId: string, baseUrl: string): EmailText {
  return {
    subject: `Your ${roleName.toLowerCase()} profile is live (${NAME})`,
    text: [
      'Hi,',
      '',
      `We checked your ${roleName.toLowerCase()} profile and it is live. Clients can now find you on People and ask to book you.`,
      'When someone asks, we email you to check you can do it.',
      '',
      PERSON_PAYOUT_LINE,
      '',
      `See your profile: ${baseUrl}/people/${personRoleId}`,
    ].join('\n'),
  };
}

export function profileSentBackEmail(roleName: string, note: string, baseUrl: string): EmailText {
  return {
    subject: `One change to your ${roleName.toLowerCase()} profile (${NAME})`,
    text: [
      'Hi,',
      '',
      `We looked at your ${roleName.toLowerCase()} profile. Before it can go live, here is what to change:`,
      '',
      note,
      '',
      'Make the change, then send it again. We look at it again within 2 working days.',
      '',
      `Open your profile: ${baseUrl}/offer`,
    ].join('\n'),
  };
}
