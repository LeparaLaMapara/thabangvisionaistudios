export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { validateCronAuth } from '@/lib/cron/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';
import {
  detectPaidButStuck,
  detectIneffectiveCronArms,
  detectMissingRelations,
  detectStaleWritePaths,
  type PaidBookingRow,
  type CronArmOutcome,
  type TableFreshness,
} from '@/lib/ops/checks';
import { fingerprint, type Finding } from '@/lib/ops/types';

/**
 * Invariant sweep.
 *
 * This is the honest version of "self-healing". It heals nothing. It notices,
 * de-duplicates, and tells a human once. Every serious defect in this codebase
 * this week was silent rather than loud, so the first thing worth building is
 * not something that acts -- it is something that can see. Anything that acts
 * later reads from ops_findings.
 *
 * No model is called anywhere in this file, deliberately. Detection is a query
 * and a comparison. A model asked whether the platform is healthy will answer
 * "healthy", because that is the modal output over log text.
 *
 * Returns 500 when any critical invariant is violated, so Vercel marks the run
 * failed and platform alerting fires for free.
 *
 * Scheduled DAILY, not every 30 minutes, because the current Vercel plan
 * rejects sub-daily crons -- and rejects them by refusing to create a
 * deployment at all, which is indistinguishable from a broken webhook. See
 * the cron section in CLAUDE.md before changing the schedule.
 */

const REQUIRED_RELATIONS = [
  'bookings', 'equipment_bookings', 'booking_payments', 'cart_items',
  'crew_requests', 'disputes', 'dispute_comments', 'notifications',
  'newsletter_subscribers', 'press', 'profiles', 'smart_rentals',
  'moderation_log', 'platform_events', 'ai_token_usage', 'ubunye_usage',
];

/**
 * A live marketing site whose subscriber table never grows is the shape of the
 * newsletter bug: the route returned success and discarded every address.
 */
const FRESHNESS: Array<{ table: string; column: string; maxAgeHours: number }> = [
  { table: 'platform_events', column: 'created_at', maxAgeHours: 24 * 7 },
  { table: 'ai_token_usage', column: 'created_at', maxAgeHours: 24 * 30 },
];

type Sb = ReturnType<typeof createAdminClient>;

async function countWhere(
  db: Sb,
  table: string,
  build: (q: ReturnType<Sb['from']>) => unknown,
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = build(db.from(table) as never);
  const { count, error } = await q;
  // Throw rather than return 0. A check that cannot answer must not be
  // mistaken for a check that found nothing -- that is the bug being fixed.
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const db = createAdminClient();
  const now = new Date();
  const startedAt = Date.now();
  const findings: Finding[] = [];
  const checkErrors: Record<string, string> = {};

  // ── Relations the code depends on ─────────────────────────────────────────
  try {
    const present: string[] = [];
    for (const t of REQUIRED_RELATIONS) {
      const { error } = await db.from(t).select('*', { count: 'exact', head: true });
      // 42P01 / PGRST205: relation absent. Anything else is a live table.
      if (!error || !/does not exist|PGRST205|42P01/i.test(error.message)) present.push(t);
    }
    findings.push(...detectMissingRelations({ required: REQUIRED_RELATIONS, present }));
  } catch (err) {
    checkErrors['relation-missing'] = String(err);
  }

  // ── Money took, state did not move ────────────────────────────────────────
  try {
    const rows: PaidBookingRow[] = [];

    const { data: eq, error: eqErr } = await db
      .from('booking_payments')
      .select('booking_id, created_at, amount, payfast_payment_id, status, equipment_bookings(id, status)')
      .eq('status', 'complete')
      .limit(500);
    if (eqErr) throw new Error(`booking_payments: ${eqErr.message}`);

    for (const p of eq ?? []) {
      const embed = (p as unknown as {
        equipment_bookings?: { id: string; status: string } | { id: string; status: string }[];
      }).equipment_bookings;
      // PostgREST returns an embed as an array even for a to-one relation.
      const b = Array.isArray(embed) ? embed[0] : embed;
      if (!b) continue;
      rows.push({
        id: b.id,
        status: b.status,
        paidAt: (p as { created_at: string }).created_at,
        reference: (p as { payfast_payment_id: string | null }).payfast_payment_id,
        amount: (p as { amount: number | null }).amount,
        kind: 'equipment',
      });
    }

    const { data: svc, error: svcErr } = await db
      .from('bookings')
      .select('id, status, paid_at, reference, total')
      .eq('payment_status', 'paid')
      .not('paid_at', 'is', null)
      .limit(500);
    if (svcErr) throw new Error(`bookings: ${svcErr.message}`);

    for (const b of svc ?? []) {
      const row = b as { id: string; status: string; paid_at: string; reference: string; total: number };
      rows.push({
        id: row.id, status: row.status, paidAt: row.paid_at,
        reference: row.reference, amount: row.total, kind: 'service',
      });
    }

    findings.push(...detectPaidButStuck(rows, now));
  } catch (err) {
    checkErrors['paid-but-stuck'] = String(err);
  }

  // ── Cron arms judged by their effect on the world, not their own report ───
  try {
    const iso = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
    const day = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString().slice(0, 10);

    const outcomes: CronArmOutcome[] = [
      {
        arm: 'expire_stale_crew_requests',
        violations: await countWhere(db, 'crew_requests', (q) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (q as any).select('id', { count: 'exact', head: true })
            .eq('status', 'pending').lt('created_at', iso(24 * 8))),
      },
      {
        arm: 'cancel_unpaid_bookings',
        violations: await countWhere(db, 'bookings', (q) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (q as any).select('id', { count: 'exact', head: true })
            .eq('status', 'pending').eq('payment_status', 'unpaid').lt('created_at', iso(73))),
      },
      {
        arm: 'auto_approve_delivered',
        violations: await countWhere(db, 'bookings', (q) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (q as any).select('id', { count: 'exact', head: true })
            .eq('status', 'delivered').lt('delivered_at', iso(24 * 8))),
      },
      {
        arm: 'mark_overdue_rentals',
        violations: await countWhere(db, 'equipment_bookings', (q) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (q as any).select('id', { count: 'exact', head: true })
            .eq('status', 'active').lt('end_date', day(1))),
      },
    ];
    findings.push(...detectIneffectiveCronArms(outcomes));
  } catch (err) {
    checkErrors['cron-arm-ineffective'] = String(err);
  }

  // ── Write paths that went quiet ───────────────────────────────────────────
  try {
    const rows: TableFreshness[] = [];
    for (const f of FRESHNESS) {
      const { data, error } = await db
        .from(f.table).select(f.column).order(f.column, { ascending: false }).limit(1);
      if (error) throw new Error(`${f.table}: ${error.message}`);
      const last = (data?.[0] as unknown as Record<string, string> | undefined)?.[f.column] ?? null;
      rows.push({ table: f.table, lastWrite: last, maxAgeHours: f.maxAgeHours });
    }
    findings.push(...detectStaleWritePaths(rows, now));
  } catch (err) {
    checkErrors['write-path-stale'] = String(err);
  }

  // ── Record ────────────────────────────────────────────────────────────────
  const durationMs = Date.now() - startedAt;
  const runError = Object.keys(checkErrors).length ? JSON.stringify(checkErrors) : null;

  await db.from('ops_check_runs').insert({
    check_id: 'invariant-sweep',
    started_at: new Date(startedAt).toISOString(),
    finished_at: now.toISOString(),
    duration_ms: durationMs,
    findings_count: findings.length,
    error: runError,
  });

  // Upsert by fingerprint: seeing the same problem again bumps a counter, it
  // does not create a second row and it does not re-notify.
  const newlyOpened: Finding[] = [];
  for (const f of findings) {
    const fp = fingerprint(f);
    const { data: existing } = await db
      .from('ops_findings').select('id, seen_count, status').eq('fingerprint', fp).maybeSingle();

    if (existing) {
      await db.from('ops_findings').update({
        last_seen_at: now.toISOString(),
        seen_count: ((existing as { seen_count: number }).seen_count ?? 0) + 1,
        severity: f.severity,
        detail: f.detail ?? {},
        observed_value: f.observedValue ?? null,
        status: (existing as { status: string }).status === 'resolved' ? 'open' : (existing as { status: string }).status,
      }).eq('fingerprint', fp);
    } else {
      await db.from('ops_findings').insert({
        fingerprint: fp,
        check_id: f.checkId,
        severity: f.severity,
        entity_type: f.entityType,
        entity_id: f.entityId,
        title: f.title,
        detail: f.detail ?? {},
        observed_value: f.observedValue ?? null,
        threshold: f.threshold ?? null,
      });
      newlyOpened.push(f);
    }
  }

  // Auto-resolve by absence, but ONLY when the sweep itself was clean. Without
  // that guard a crashed checker silently marks every open finding fixed.
  if (!runError) {
    const seen = findings.map(fingerprint);
    const q = db.from('ops_findings').update({
      status: 'resolved', resolved_at: now.toISOString(), resolution_source: 'auto',
    }).in('status', ['open', 'acknowledged']);
    await (seen.length ? q.not('fingerprint', 'in', `(${seen.map((s) => `"${s}"`).join(',')})`) : q);
  }

  // Notify on transition only: a new problem, never a re-sighting.
  if (newlyOpened.length > 0) {
    const critical = newlyOpened.filter((f) => f.severity === 'critical');
    try {
      await emailProvider.sendEmail({
        to: STUDIO.email,
        subject: `[ops] ${newlyOpened.length} new finding(s), ${critical.length} critical`,
        text: newlyOpened
          .map((f) => `[${f.severity.toUpperCase()}] ${f.title}\n  ${f.checkId} :: ${f.entityType}/${f.entityId}`)
          .join('\n\n'),
      });
    } catch (err) {
      console.error('[invariants] alert email failed:', err);
    }
  }

  const criticalOpen = findings.filter((f) => f.severity === 'critical').length;

  return NextResponse.json(
    {
      ok: criticalOpen === 0 && !runError,
      durationMs,
      findings: findings.length,
      newlyOpened: newlyOpened.length,
      critical: criticalOpen,
      checkErrors: runError ? checkErrors : undefined,
    },
    // Non-200 so the platform's own cron alerting fires without extra wiring.
    { status: criticalOpen > 0 || runError ? 500 : 200 },
  );
}
