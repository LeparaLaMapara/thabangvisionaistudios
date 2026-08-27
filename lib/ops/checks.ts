import type { Finding, Severity } from './types';

/**
 * Pure detectors. No database, no network, no model.
 *
 * Each takes rows already gathered and returns findings, or an empty array
 * when the property holds. Every one of these corresponds to a defect that was
 * actually live in this codebase, which is the only reason it is here -- an
 * invariant nobody has ever violated is a guess.
 */

const HOUR = 60 * 60 * 1000;

// ─── 1. Money took, state did not move ──────────────────────────────────────
// The strongest invariant in the system. The gateway confirmed a payment and
// the booking never advanced. Catches: the webhook reconciling against the
// wrong total (which would have flagged every paid cart order as a mismatch
// and pushed it back to pending), a signature failure, a function timeout
// mid-webhook, and any future typo in the confirm path.

export interface PaidBookingRow {
  id: string;
  status: string;
  /** Gateway-confirmed payment time, ISO. */
  paidAt: string;
  reference?: string | null;
  amount?: number | null;
  kind: 'equipment' | 'service';
}

const ADVANCED_EQUIPMENT = new Set([
  'confirmed', 'active', 'return_pending', 'return_reviewed', 'completed', 'disputed', 'cancelled',
]);
const ADVANCED_SERVICE = new Set([
  'paid', 'accepted', 'delivered', 'completed', 'paid_out', 'disputed', 'cancelled', 'pending_reassignment',
]);

/**
 * Equipment and service bookings use different vocabularies -- equipment goes
 * to 'confirmed', service goes to 'paid'. Conflating them produces false
 * positives on every service booking, so they are checked separately.
 */
export function detectPaidButStuck(
  rows: PaidBookingRow[],
  now: Date,
  graceMinutes = 15,
): Finding[] {
  const cutoff = now.getTime() - graceMinutes * 60 * 1000;

  return rows
    .filter((r) => {
      const paid = new Date(r.paidAt).getTime();
      if (Number.isNaN(paid) || paid > cutoff) return false;
      const advanced = r.kind === 'equipment' ? ADVANCED_EQUIPMENT : ADVANCED_SERVICE;
      return !advanced.has(r.status);
    })
    .map((r) => ({
      checkId: 'paid-but-stuck',
      severity: 'critical' as Severity,
      entityType: r.kind === 'equipment' ? 'equipment_booking' : 'booking',
      entityId: r.id,
      title: `Payment confirmed but ${r.kind} booking still ${r.status}`,
      detail: { reference: r.reference ?? null, amount: r.amount ?? null, paidAt: r.paidAt },
      observedValue: Math.round((now.getTime() - new Date(r.paidAt).getTime()) / 60000),
      threshold: graceMinutes,
    }));
}

// ─── 2. Cron arms that produced no effect ───────────────────────────────────
// Asserts the WORLD, not the job. That distinction is the whole point: the
// crew-request expiry arm queried a table that never existed, the error was
// discarded at the destructuring site, and the arm reported success for the
// life of the platform. A check on the job would have believed it. A check on
// the world would have fired on day eight.

export interface CronArmOutcome {
  /** Matches the arm name in daily-maintenance. */
  arm: string;
  /** Rows that should not exist if the arm is working. */
  violations: number;
}

export function detectIneffectiveCronArms(outcomes: CronArmOutcome[]): Finding[] {
  return outcomes
    .filter((o) => o.violations > 0)
    .map((o) => ({
      checkId: 'cron-arm-ineffective',
      // Per-arm, never per-row: one broken arm is one problem, not N.
      entityType: 'cron_arm',
      entityId: o.arm,
      severity: 'critical' as Severity,
      title: `Cron arm "${o.arm}" left ${o.violations} row(s) it should have handled`,
      detail: { arm: o.arm },
      observedValue: o.violations,
      threshold: 0,
    }));
}

// ─── 3. Vocabulary drift ────────────────────────────────────────────────────
// A CHECK constraint that has fallen behind the code. Fifteen of twenty-three
// notification types were rejected by Postgres on every insert, so most of the
// notification system was a silent no-op: nobody was told their gear was
// overdue, their deposit had been decided, or that they had been paid.

export function detectVocabularyDrift(params: {
  checkId: string;
  entityType: string;
  emitted: string[];
  allowed: string[];
}): Finding[] {
  const allowed = new Set(params.allowed);
  const rejected = params.emitted.filter((v) => !allowed.has(v)).sort();
  if (rejected.length === 0) return [];

  return [{
    checkId: params.checkId,
    severity: 'critical',
    entityType: params.entityType,
    // Per-constraint: one drifted vocabulary is one problem.
    entityId: params.entityType,
    title: `${rejected.length} ${params.entityType} value(s) the code writes are rejected by the database`,
    detail: { rejected, allowedCount: params.allowed.length },
    observedValue: rejected.length,
    threshold: 0,
  }];
}

// ─── 4. Reconciliation false-positive rate ──────────────────────────────────
// A rate, not an instance. One mismatch is a customer story; several in an
// hour is a deploy that broke reconciliation.

export function detectMismatchRate(params: {
  mismatched: number;
  touched: number;
  minCount?: number;
  maxPercent?: number;
}): Finding[] {
  const minCount = params.minCount ?? 3;
  const maxPercent = params.maxPercent ?? 20;
  if (params.touched === 0) return [];

  const pct = (params.mismatched / params.touched) * 100;
  if (params.mismatched < minCount && pct <= maxPercent) return [];

  return [{
    checkId: 'reconciliation-mismatch-rate',
    severity: 'critical',
    entityType: 'payment_reconciliation',
    entityId: 'last_24h',
    title: `${params.mismatched} of ${params.touched} recent bookings flagged as amount mismatch`,
    detail: { mismatched: params.mismatched, touched: params.touched, pct: Math.round(pct * 10) / 10 },
    observedValue: Math.round(pct * 10) / 10,
    threshold: maxPercent,
  }];
}

// ─── 5. A state change nobody was told about ────────────────────────────────
// Independent of vocabulary drift, and catches any silent notification loss.

export interface TransitionRow {
  entityId: string;
  userId: string;
  status: string;
  changedAt: string;
  notified: boolean;
}

export function detectUnnotifiedTransitions(
  rows: TransitionRow[],
  now: Date,
  graceMinutes = 30,
): Finding[] {
  const cutoff = now.getTime() - graceMinutes * 60 * 1000;
  return rows
    .filter((r) => !r.notified && new Date(r.changedAt).getTime() <= cutoff)
    .map((r) => ({
      checkId: 'transition-not-notified',
      severity: 'warn' as Severity,
      entityType: 'equipment_booking',
      entityId: r.entityId,
      title: `Booking moved to ${r.status} but the hirer was never notified`,
      detail: { userId: r.userId, status: r.status, changedAt: r.changedAt },
    }));
}

// ─── 6. Write path went quiet ───────────────────────────────────────────────
// Generic silent-drop detector. Would have caught newsletter signups being
// discarded: a live marketing site whose subscriber table had never grown.

export interface TableFreshness {
  table: string;
  lastWrite: string | null;
  maxAgeHours: number;
}

export function detectStaleWritePaths(rows: TableFreshness[], now: Date): Finding[] {
  return rows
    .filter((r) => {
      if (r.lastWrite === null) return true;
      const age = now.getTime() - new Date(r.lastWrite).getTime();
      return age > r.maxAgeHours * HOUR;
    })
    .map((r) => ({
      checkId: 'write-path-stale',
      severity: 'warn' as Severity,
      entityType: 'table',
      entityId: r.table,
      title: r.lastWrite === null
        ? `${r.table} has never been written to`
        : `${r.table} has not been written to in over ${r.maxAgeHours}h`,
      detail: { lastWrite: r.lastWrite },
      threshold: r.maxAgeHours,
    }));
}

// ─── 7. Missing relations ───────────────────────────────────────────────────
// Cheapest check here and it catches the deadliest class. Three tables the
// code queried did not exist in production.

export function detectMissingRelations(params: {
  required: string[];
  present: string[];
}): Finding[] {
  const present = new Set(params.present);
  return params.required
    .filter((t) => !present.has(t))
    .map((t) => ({
      checkId: 'relation-missing',
      severity: 'critical' as Severity,
      entityType: 'relation',
      entityId: t,
      title: `Code queries "${t}" but it does not exist in this database`,
      detail: { relation: t },
    }));
}
