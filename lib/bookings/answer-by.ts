/**
 * When a creator must answer a paid booking, and when the shoot day starts.
 * Pure, so the daily job, the job card and the emails all agree.
 *
 * The daily maintenance job passes a paid booking that the creator has not
 * accepted or declined to another creator once STUDIO.booking.creatorAnswerHours
 * have gone by. The clock starts when the client PAID (paid_at). Before this
 * it started at created_at, so a booking paid a day or two after it was made
 * could be taken away from the creator on the next run, with no time to answer.
 *
 * When an admin gives the job to a creator (assign or swap), the clock starts
 * again at that moment (assigned_at). The time comes from the latest
 * 'admin_assign' row in service_booking_events (getAssignTimes in
 * lib/supabase/queries/service-bookings.ts); bookings has no column for it.
 * Without this a creator assigned two days after payment was passed on at the
 * next daily run, with no reminder and a card showing 0 hours left.
 */

import { STUDIO } from '@/lib/constants';
import { startOfBookedDay } from '@/lib/rental/cancellation';

const HOUR_MS = 60 * 60 * 1000;

export interface AnswerClock {
  created_at: string;
  paid_at?: string | null;
  /** When an admin last gave this job to the current creator, if ever. */
  assigned_at?: string | null;
}

/** When the creator's answer window starts: the later of the assignment and the payment (created_at for older rows). */
export function answerClockStart(b: AnswerClock): Date {
  const paid = Date.parse(b.paid_at ?? b.created_at);
  const assigned = b.assigned_at ? Date.parse(b.assigned_at) : NaN;
  return new Date(Number.isFinite(assigned) && assigned > paid ? assigned : paid);
}

/** The moment the creator's answer is due: the clock start (assignment, payment or creation) plus the answer window. */
export function answerByAt(b: AnswerClock, hours: number = STUDIO.booking.creatorAnswerHours): Date {
  return new Date(answerClockStart(b).getTime() + hours * HOUR_MS);
}

/** True once the answer window has passed: the daily job may pass the job on. */
export function answerWindowPassed(b: AnswerClock, now: Date, hours?: number): boolean {
  return now.getTime() >= answerByAt(b, hours).getTime();
}

/**
 * True when the deadline falls inside the next reminder window, i.e. this is
 * the last daily run before the job is passed on. The job runs once a day, so
 * each booking is in this window on exactly one run.
 */
export function needsAnswerReminder(
  b: AnswerClock,
  now: Date,
  reminderHours: number = STUDIO.booking.creatorAnswerReminderHours,
  hours?: number,
): boolean {
  const msLeft = answerByAt(b, hours).getTime() - now.getTime();
  return msLeft > 0 && msLeft <= reminderHours * HOUR_MS;
}

/** Whole hours left to answer, never below zero. */
export function hoursLeftToAnswer(b: AnswerClock, now: Date, hours?: number): number {
  return Math.max(0, Math.floor((answerByAt(b, hours).getTime() - now.getTime()) / HOUR_MS));
}

/** "I'm here" is for the shoot day: true from the start of the booked day (SAST), or when no date is booked. */
export function canCheckIn(shootDate: string | null | undefined, now: Date): boolean {
  if (!shootDate) return true;
  return now.getTime() >= startOfBookedDay(shootDate).getTime();
}

const SAST = 'Africa/Johannesburg';

/** e.g. "Sat 18 Oct 2026, 14:00" in South African time. */
export function formatSastDateTime(d: Date | string): string {
  return new Date(d).toLocaleString('en-ZA', {
    timeZone: SAST,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The booked shoot day, e.g. "Saturday 18 October 2026". A date-only value is the SAST day. */
export function formatShootDate(shootDate: string): string {
  return startOfBookedDay(shootDate).toLocaleDateString('en-ZA', {
    timeZone: SAST,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
