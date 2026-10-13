import { STUDIO } from '@/lib/constants';

/**
 * Log retention for the daily maintenance job.
 *
 * Deletes old rows from the logs that grow with traffic, through
 * `prune_log_retention()` (migration 086), one bounded batch at a time so the
 * job cannot time out. The database decides which rows of each table may go
 * (payment events only once processed or ignored, notifications only once
 * read) and refuses retention shorter than its floors. Chat history and the
 * money ledger are never pruned here.
 */

export interface RetentionPolicy {
  platformEventsDays: number;
  aiTokenUsageDays: number;
  securityAuditLogDays: number;
  paymentEventsDays: number;
  readNotificationsDays: number;
  batchSize: number;
  maxBatchesPerTable: number;
}

export type RetentionTable =
  | 'platform_events'
  | 'ai_token_usage'
  | 'security_audit_log'
  | 'payment_events'
  | 'notifications';

/** Days kept per table, from the policy in lib/constants.ts. */
export function retentionDays(policy: RetentionPolicy): Record<RetentionTable, number> {
  return {
    platform_events: policy.platformEventsDays,
    ai_token_usage: policy.aiTokenUsageDays,
    security_audit_log: policy.securityAuditLogDays,
    payment_events: policy.paymentEventsDays,
    notifications: policy.readNotificationsDays,
  };
}

export interface RetentionClient {
  rpc: (
    fn: 'prune_log_retention',
    args: { p_table: RetentionTable; p_older_than_days: number; p_limit: number },
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type TableResult = { deleted: number; days: number; more: boolean } | { error: string; deleted: number };

/**
 * Runs up to policy.maxBatchesPerTable deletes of policy.batchSize rows per
 * table, stopping early once a batch comes back short. One table failing
 * (for example before 086 is applied) does not stop the others.
 * `more` is true when the last batch was full: rows are left for tomorrow.
 */
export async function pruneLogs(
  db: RetentionClient,
  policy: RetentionPolicy = STUDIO.retention,
): Promise<Record<RetentionTable, TableResult>> {
  const days = retentionDays(policy);
  const out = {} as Record<RetentionTable, TableResult>;

  for (const table of Object.keys(days) as RetentionTable[]) {
    let deleted = 0;
    let more = false;
    try {
      for (let batch = 0; batch < policy.maxBatchesPerTable; batch++) {
        const { data, error } = await db.rpc('prune_log_retention', {
          p_table: table,
          p_older_than_days: days[table],
          p_limit: policy.batchSize,
        });
        if (error) throw new Error(error.message);
        const n = typeof data === 'number' ? data : Number(data ?? 0);
        deleted += Number.isFinite(n) ? n : 0;
        more = n >= policy.batchSize;
        if (!more) break;
      }
      out[table] = { deleted, days: days[table], more };
    } catch (err) {
      out[table] = { error: err instanceof Error ? err.message : String(err), deleted };
    }
  }
  return out;
}
