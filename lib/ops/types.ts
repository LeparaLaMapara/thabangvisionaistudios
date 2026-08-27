/**
 * The ops layer: how the platform notices things about itself.
 *
 * Design note, because the shape is deliberate and easy to get wrong.
 *
 * The unit is the INVARIANT, not a job title. There is no "software engineer
 * agent" or "data scientist agent" here, on purpose: a job title is not a
 * decomposition of work. It has no testable success predicate, its scope
 * overlaps every other title, and five personas looking at one stuck payout
 * produce five opinions about one incident. An invariant is a property that
 * must hold, owned by one cheap deterministic check, with a precision you can
 * measure and a mute you can pull.
 *
 * Detection is ALWAYS deterministic. A model is never asked whether something
 * is broken. A model asked to go looking for problems will always find some,
 * and will be fluent about it. Later, optionally, a model may explain a finding
 * a detector already raised -- that is the only place it earns its tokens.
 *
 * Every detector is split into gather (touches the database) and detect (pure).
 * The pure half is what makes the tests free: no model calls, no network,
 * milliseconds, and negative fixtures that prove the check STAYS QUIET on
 * healthy-but-unusual data. A check that never says "nothing to do here" is
 * broken, and only negatives can prove it does.
 */

export type Severity = 'info' | 'warn' | 'critical';

export interface Finding {
  /** Which invariant raised this. Stable, kebab-case. */
  checkId: string;
  severity: Severity;
  /** What kind of thing is wrong: 'relation' | 'booking' | 'cron_arm' | ... */
  entityType: string;
  /**
   * Which one. Grain matters: per-row where each row is separately
   * actionable, per-check where one bug affects everything, or a single
   * broken cron arm emits four hundred findings.
   */
  entityId: string;
  title: string;
  detail?: Record<string, unknown>;
  observedValue?: number;
  threshold?: number;
}

/**
 * Stable identity for "the same problem, seen again".
 *
 * Contains no timestamp and no counter, deliberately. Put either in and the
 * findings table degenerates into the log this exists to replace.
 */
export function fingerprint(
  f: Pick<Finding, 'checkId' | 'entityType' | 'entityId'>,
): string {
  return `${f.checkId}:${f.entityType}:${f.entityId}`;
}
