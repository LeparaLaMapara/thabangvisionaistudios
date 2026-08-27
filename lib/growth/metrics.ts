import type { SupabaseClient } from '@supabase/supabase-js';
import { ZERO_METRICS, type GrowthMetrics } from './checkpoints';

/**
 * The gather half of the checkpoint system. Touches the database; the
 * evaluation next door is pure.
 *
 * Counts only, never rows. This runs on a schedule and the answer is eight
 * integers, so `head: true` with an exact count keeps it to metadata rather
 * than dragging tables across the wire.
 *
 * A failed count returns its zero rather than throwing. A checkpoint fires when
 * a number gets big enough, so a missing number reads as "not yet" — the safe
 * direction. The alternative, a failed read looking like growth, would announce
 * capabilities the platform has not earned.
 */
async function countOrZero(
  build: () => PromiseLike<{ count: number | null; error: unknown }>,
  label: string,
): Promise<number> {
  try {
    const { count, error } = await build();
    if (error) {
      const message = (error as { message?: string }).message ?? String(error);
      // Tables arrive with their migrations; absence is expected, not alarming.
      if (!message.includes('does not exist')) {
        console.error(`[growth/metrics] ${label}:`, message);
      }
      return 0;
    }
    return count ?? 0;
  } catch (err) {
    console.error(`[growth/metrics] ${label} threw:`, err);
    return 0;
  }
}

export async function gatherGrowthMetrics(
  db: SupabaseClient,
): Promise<GrowthMetrics> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [
    liveRentals,
    publishedProductions,
    crewWithSpecialisation,
    communityOwnedRentals,
    completedBookings,
    inspectedReturns,
  ] = await Promise.all([
    countOrZero(() => db.from('smart_rentals').select('id', { count: 'exact', head: true })
      .eq('is_published', true).eq('is_archived', false).is('deleted_at', null), 'liveRentals'),

    countOrZero(() => db.from('smart_productions').select('id', { count: 'exact', head: true })
      .eq('is_published', true).is('deleted_at', null), 'publishedProductions'),

    // `neq('specializations', '{}')` is the empty-array test in PostgREST.
    countOrZero(() => db.from('profiles').select('id', { count: 'exact', head: true })
      .not('specializations', 'is', null).neq('specializations', '{}'), 'crewWithSpecialisation'),

    countOrZero(() => db.from('smart_rentals').select('id', { count: 'exact', head: true })
      .eq('owner_type', 'community').is('deleted_at', null), 'communityOwnedRentals'),

    countOrZero(() => db.from('equipment_bookings').select('id', { count: 'exact', head: true })
      .in('status', ['confirmed', 'active', 'return_pending', 'completed']), 'completedBookings'),

    countOrZero(() => db.from('equipment_bookings').select('id', { count: 'exact', head: true })
      .not('condition_at_return', 'is', null), 'inspectedReturns'),
  ]);

  // Distinct counts have no head:true equivalent, so these two read rows. Both
  // are small and bounded: production types across published work, and 90 days
  // of unmet-demand queries.
  const productionTypes = await distinctCount(
    db, 'smart_productions', 'project_type',
    (q) => q.eq('is_published', true).is('deleted_at', null),
  );

  const unmetDemandSignals = await distinctCount(
    db, 'unmet_demand', 'query',
    (q) => q.gte('created_at', ninetyDaysAgo),
  );

  return {
    ...ZERO_METRICS,
    liveRentals,
    publishedProductions,
    productionTypes,
    crewWithSpecialisation,
    communityOwnedRentals,
    completedBookings,
    unmetDemandSignals,
    inspectedReturns,
  };
}

/** Distinct non-null values of one column, counted in memory. */
async function distinctCount(
  db: SupabaseClient,
  table: string,
  column: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  narrow: (q: any) => any,
): Promise<number> {
  try {
    const { data, error } = await narrow(db.from(table).select(column));
    if (error) {
      const message = (error as { message?: string }).message ?? String(error);
      if (!message.includes('does not exist')) {
        console.error(`[growth/metrics] distinct ${table}.${column}:`, message);
      }
      return 0;
    }
    const values = ((data ?? []) as Record<string, unknown>[])
      .map((r) => r[column])
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    return new Set(values).size;
  } catch (err) {
    console.error(`[growth/metrics] distinct ${table}.${column} threw:`, err);
    return 0;
  }
}
