import { describe, it, expect } from 'vitest';
import { STUDIO } from '@/lib/constants';
import { pruneLogs, retentionDays, type RetentionClient, type RetentionPolicy } from '@/lib/cron/retention';

// Daily maintenance step 17: old log rows are deleted through
// prune_log_retention (migration 086) in bounded batches.

type Call = { p_table: string; p_older_than_days: number; p_limit: number };

function fakeDb(rowsPerTable: Record<string, number>, failing: string[] = []) {
  const left = { ...rowsPerTable };
  const calls: Call[] = [];
  const db: RetentionClient = {
    rpc: (fn, args) => {
      expect(fn).toBe('prune_log_retention');
      calls.push(args);
      if (failing.includes(args.p_table)) {
        return Promise.resolve({ data: null, error: { message: 'function public.prune_log_retention does not exist' } });
      }
      const n = Math.min(left[args.p_table] ?? 0, args.p_limit);
      left[args.p_table] = (left[args.p_table] ?? 0) - n;
      return Promise.resolve({ data: n, error: null });
    },
  };
  return { db, calls, left };
}

const small: RetentionPolicy = { ...STUDIO.retention, batchSize: 10, maxBatchesPerTable: 3 };

describe('retention policy (lib/constants.ts)', () => {
  it('keeps the agreed periods', () => {
    expect(STUDIO.retention.platformEventsDays).toBe(180);
    expect(STUDIO.retention.aiTokenUsageDays).toBe(365);
    expect(STUDIO.retention.securityAuditLogDays).toBe(365);
    expect(STUDIO.retention.paymentEventsDays).toBe(365);
    expect(STUDIO.retention.readNotificationsDays).toBe(180);
  });

  it('respects the database floors (365 for audit, payments, AI cost; 30 for the rest)', () => {
    const d = retentionDays(STUDIO.retention);
    expect(d.security_audit_log).toBeGreaterThanOrEqual(365);
    expect(d.payment_events).toBeGreaterThanOrEqual(365);
    expect(d.ai_token_usage).toBeGreaterThanOrEqual(365);
    expect(d.platform_events).toBeGreaterThanOrEqual(30);
    expect(d.notifications).toBeGreaterThanOrEqual(30);
  });

  it('bounds one run: batch size within the database limit', () => {
    expect(STUDIO.retention.batchSize).toBeGreaterThan(0);
    expect(STUDIO.retention.batchSize).toBeLessThanOrEqual(10_000);
    expect(STUDIO.retention.maxBatchesPerTable).toBeGreaterThan(0);
  });
});

describe('pruneLogs', () => {
  it('prunes only the five log tables, never chat or the ledger', async () => {
    const { db, calls } = fakeDb({});
    await pruneLogs(db, small);
    const tables = [...new Set(calls.map((c) => c.p_table))].sort();
    expect(tables).toEqual(['ai_token_usage', 'notifications', 'payment_events', 'platform_events', 'security_audit_log']);
    expect(tables.some((t) => /chat|ledger|bookings|payout/.test(t))).toBe(false);
  });

  it('passes each table its own day count and the batch size', async () => {
    const { db, calls } = fakeDb({});
    await pruneLogs(db, small);
    const byTable = Object.fromEntries(calls.map((c) => [c.p_table, c]));
    expect(byTable.platform_events).toMatchObject({ p_older_than_days: 180, p_limit: 10 });
    expect(byTable.ai_token_usage).toMatchObject({ p_older_than_days: 365, p_limit: 10 });
    expect(byTable.security_audit_log).toMatchObject({ p_older_than_days: 365, p_limit: 10 });
    expect(byTable.payment_events).toMatchObject({ p_older_than_days: 365, p_limit: 10 });
    expect(byTable.notifications).toMatchObject({ p_older_than_days: 180, p_limit: 10 });
  });

  it('stops after a short batch', async () => {
    const { db, calls } = fakeDb({ platform_events: 15 });
    const out = await pruneLogs(db, small);
    expect(calls.filter((c) => c.p_table === 'platform_events')).toHaveLength(2);
    expect(out.platform_events).toEqual({ deleted: 15, days: 180, more: false });
    // A table with nothing to delete costs one call.
    expect(calls.filter((c) => c.p_table === 'notifications')).toHaveLength(1);
  });

  it('caps the work per run and reports what is left for tomorrow', async () => {
    const { db, calls, left } = fakeDb({ ai_token_usage: 1000 });
    const out = await pruneLogs(db, small);
    expect(calls.filter((c) => c.p_table === 'ai_token_usage')).toHaveLength(3);
    expect(out.ai_token_usage).toEqual({ deleted: 30, days: 365, more: true });
    expect(left.ai_token_usage).toBe(970);
  });

  it('one failing table does not stop the others', async () => {
    const { db } = fakeDb({ notifications: 4 }, ['platform_events']);
    const out = await pruneLogs(db, small);
    expect(out.platform_events).toMatchObject({ deleted: 0 });
    expect('error' in out.platform_events && out.platform_events.error).toMatch(/does not exist/);
    expect(out.notifications).toEqual({ deleted: 4, days: 180, more: false });
  });

  it('uses STUDIO.retention by default', async () => {
    const { db, calls } = fakeDb({});
    await pruneLogs(db);
    expect(calls.every((c) => c.p_limit === STUDIO.retention.batchSize)).toBe(true);
  });
});
