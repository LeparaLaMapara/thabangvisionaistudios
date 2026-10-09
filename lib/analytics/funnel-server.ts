import { createAdminClient } from '@/lib/supabase/server';
import { FUNNEL_STAGES, funnelEventType, type FunnelStage } from '@/lib/core/analytics/funnel';

/** Rows read for one report. Funnel events are small; this caps a runaway query. */
const MAX_ROWS = 50_000;

export interface FunnelCounts {
  /** Events per stage. */
  events: Partial<Record<FunnelStage, number>>;
  /** Distinct signed-in accounts per stage (signed-out views count only as events). */
  people: Partial<Record<FunnelStage, number>>;
  truncated: boolean;
}

/** Counts per funnel stage since a date, from platform_events (category 'funnel'). */
export async function loadFunnelCounts(since: Date): Promise<FunnelCounts> {
  const { data, error } = await createAdminClient()
    .from('platform_events')
    .select('event_type, user_id')
    .eq('event_category', 'funnel')
    .gte('created_at', since.toISOString())
    .limit(MAX_ROWS);
  if (error) throw new Error(`funnel events: ${error.message}`);
  const rows = (data ?? []) as { event_type: string; user_id: string | null }[];
  const byType = new Map(FUNNEL_STAGES.map((s) => [funnelEventType(s), s]));
  const events: Partial<Record<FunnelStage, number>> = {};
  const people = new Map<FunnelStage, Set<string>>();
  for (const r of rows) {
    const stage = byType.get(r.event_type);
    if (!stage) continue;
    events[stage] = (events[stage] ?? 0) + 1;
    if (r.user_id) {
      if (!people.has(stage)) people.set(stage, new Set());
      people.get(stage)!.add(r.user_id);
    }
  }
  return {
    events,
    people: Object.fromEntries([...people].map(([k, v]) => [k, v.size])) as Partial<Record<FunnelStage, number>>,
    truncated: rows.length >= MAX_ROWS,
  };
}
