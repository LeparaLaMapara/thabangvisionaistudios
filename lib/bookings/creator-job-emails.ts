/**
 * The emails a creator gets about a new paid job: when it is paid, and a
 * reminder on the last daily run before it is passed to another creator.
 * Pure text builders, so they are tested; sending goes through lib/email.
 *
 * Money: bookings.creator_amount is whole rands, what the creator earns.
 * Never quote bookings.total (what the client paid) to the creator.
 */

import { STUDIO } from '@/lib/constants';
import { SIGNATURE_TEXT } from '@/lib/email/signature';
import { answerByAt, formatSastDateTime, formatShootDate, type AnswerClock } from './answer-by';

export interface CreatorJobFacts extends AnswerClock {
  reference: string;
  project_category: string;
  creator_amount: number | string | null;
  duration_hours?: number | string | null;
  shoot_date?: string | null;
  location?: string | null;
}

export interface EmailText {
  subject: string;
  text: string;
}

/** "R2 550" style amount, whole rands. */
export function formatRand(amount: number | string | null | undefined): string {
  const n = Math.round(Number(amount ?? 0));
  return `R${(Number.isFinite(n) ? n : 0).toLocaleString('en-ZA')}`;
}

function shootLine(b: CreatorJobFacts): string {
  return b.shoot_date ? `Shoot date: ${formatShootDate(b.shoot_date)}` : 'Shoot date: to be agreed with our team';
}

function detailLines(b: CreatorJobFacts): string[] {
  const hours = Number(b.duration_hours ?? 0);
  return [
    `What: ${b.project_category} (${b.reference})`,
    shootLine(b),
    ...(hours > 0 ? [`Length: ${hours} hour${hours === 1 ? '' : 's'}`] : []),
    ...(b.location ? [`Where: ${b.location}`] : []),
    `You earn: ${formatRand(b.creator_amount)}`,
  ];
}

/** In-app alert body for a new paid job: the creator's earnings, never the client total. */
export function newPaidJobNoticeBody(b: CreatorJobFacts): string {
  const hours = Number(b.duration_hours ?? 0);
  const length = hours > 0 ? `, ${hours} hrs` : '';
  return `You have a new ${b.project_category} booking (${b.reference}). You earn ${formatRand(b.creator_amount)}${length}. Accept or decline by ${formatSastDateTime(answerByAt(b))}.`;
}

export function newPaidJobEmail(b: CreatorJobFacts, baseUrl: string): EmailText {
  const due = formatSastDateTime(answerByAt(b));
  return {
    subject: `New paid job: ${b.project_category}, you earn ${formatRand(b.creator_amount)} (${STUDIO.name})`,
    text: [
      'Hi,',
      '',
      'A client has booked and paid for you.',
      '',
      ...detailLines(b),
      '',
      `Please accept or decline by ${due} (South African time).`,
      `If we do not hear from you by then, the job goes to another creator and the client is looked after.`,
      '',
      `Answer here: ${baseUrl}/dashboard/gigs`,
      '',
      SIGNATURE_TEXT,
    ].join('\n'),
  };
}

export function answerReminderEmail(b: CreatorJobFacts, baseUrl: string): EmailText {
  const due = formatSastDateTime(answerByAt(b));
  return {
    subject: `Reminder: answer your paid job by ${due} (${STUDIO.name})`,
    text: [
      'Hi,',
      '',
      `You have not yet accepted or declined this paid job. Please answer by ${due} (South African time), or it goes to another creator.`,
      '',
      ...detailLines(b),
      '',
      `Answer here: ${baseUrl}/dashboard/gigs`,
      '',
      SIGNATURE_TEXT,
    ].join('\n'),
  };
}

/** Title of the in-app reminder, also used to tell whether it was already sent. */
export const ANSWER_REMINDER_TITLE = 'Answer your paid job';

export function answerReminderNoticeBody(b: CreatorJobFacts): string {
  return `Please accept or decline ${b.project_category} (${b.reference}) by ${formatSastDateTime(answerByAt(b))}, or it goes to another creator. You earn ${formatRand(b.creator_amount)}.`;
}
