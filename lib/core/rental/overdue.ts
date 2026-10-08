/**
 * Overdue escalation ladder (spec §7.13). Pure.
 *
 * Every stage is a task for a PERSON, plus an honest reminder to the renter.
 * Nothing here labels anyone a thief, takes a whole deposit, reports to SAPS
 * or blocks an account indefinitely. Those are human decisions, recorded with
 * reasons, and they can be appealed.
 *
 *   +2h   reminder (SMS/email/in-app); a late fee is assessed only under the published rule
 *   +24h  staff phone follow-up
 *   +48h  formal escalation; new bookings restricted while gear is out; consider letter of demand
 *   +96h  senior review; preserve evidence; consider lawful recovery or a SAPS report where justified
 */

export const ESCALATION_STAGES = ['reminder', 'phone_follow_up', 'formal_escalation', 'senior_review'] as const;
export type EscalationStage = (typeof ESCALATION_STAGES)[number];

export const ESCALATION_LADDER: readonly { stage: EscalationStage; afterHours: number; renterNotice: boolean; staffTask: string }[] = [
  { stage: 'reminder', afterHours: 2, renterNotice: true, staffTask: 'Check the reminder reached the renter.' },
  { stage: 'phone_follow_up', afterHours: 24, renterNotice: true, staffTask: 'Phone the renter and record the outcome.' },
  {
    stage: 'formal_escalation',
    afterHours: 48,
    renterNotice: true,
    staffTask: 'Formal escalation: decide whether to send a letter of demand. New bookings are paused while gear is out.',
  },
  {
    stage: 'senior_review',
    afterHours: 96,
    renterNotice: false,
    staffTask: 'Senior review: preserve evidence and decide on lawful recovery steps. Any SAPS report is a human decision.',
  },
];

/**
 * When gear is due back. Bookings are by date. The return is due at the end
 * of the end date in South African time (SAST, UTC+2, no daylight saving),
 * matching the late-fee rule in lib/rental/late-fee.ts.
 */
export function returnDueAt(endDate: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new RangeError(`endDate must be YYYY-MM-DD (got ${endDate})`);
  // Midnight at the start of the day after endDate, SAST = 22:00 UTC on endDate.
  return new Date(`${endDate}T22:00:00.000Z`);
}

export function hoursLate(dueAt: Date, now: Date): number {
  return Math.max(0, (now.getTime() - dueAt.getTime()) / 3_600_000);
}

/** Stages that are due now and have not been recorded yet, in ladder order. */
export function dueEscalations(dueAt: Date, now: Date, done: readonly EscalationStage[]): EscalationStage[] {
  const late = hoursLate(dueAt, now);
  return ESCALATION_LADDER.filter((s) => late >= s.afterHours && !done.includes(s.stage)).map((s) => s.stage);
}

/** Whether new bookings are paused for this renter (formal escalation reached and gear still out). */
export function restrictsNewBookings(stagesReached: readonly EscalationStage[]): boolean {
  return stagesReached.includes('formal_escalation') || stagesReached.includes('senior_review');
}
