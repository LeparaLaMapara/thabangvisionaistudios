export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { validateCronAuth } from '@/lib/cron/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';

interface HealthCheck {
  service: string;
  status: 'ok' | 'error';
  latencyMs?: number;
  error?: string;
}

/**
 * Hourly Checks — runs every hour
 *
 * 1. Health check: Supabase connectivity
 * 2. Alert on unassigned paid orders (12+ hours)
 * 3. Alert on overdue deliveries
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const supabase = createAdminClient();
  const now = new Date();
  const checks: HealthCheck[] = [];
  const alerts: string[] = [];

  // ─── 1. Health check: Supabase ────────────────────────────────────────────
  try {
    const start = Date.now();
    const { error } = await supabase.from('profiles').select('id').limit(1);
    const latency = Date.now() - start;

    if (error) {
      checks.push({ service: 'supabase', status: 'error', error: error.message });
      alerts.push(`Supabase DOWN: ${error.message}`);
    } else {
      checks.push({ service: 'supabase', status: 'ok', latencyMs: latency });
      if (latency > 5000) {
        alerts.push(`Supabase slow: ${latency}ms`);
      }
    }
  } catch (err) {
    checks.push({ service: 'supabase', status: 'error', error: String(err) });
    alerts.push(`Supabase unreachable: ${String(err)}`);
  }

  // ─── 2. Unassigned paid orders (12+ hours) ───────────────────────────────
  try {
    const cutoff = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
    const { data: unassigned } = await supabase
      .from('bookings')
      .select('id, reference, project_category, total, created_at')
      .eq('status', 'paid')
      .is('creator_id', null)
      .lt('created_at', cutoff);

    if (unassigned && unassigned.length > 0) {
      const list = unassigned.map(b =>
        `${b.reference} — ${b.project_category} (R${b.total}) — created ${new Date(b.created_at).toLocaleString('en-ZA')}`
      ).join('\n');
      alerts.push(`${unassigned.length} unassigned paid order(s) older than 12 hours:\n${list}`);
    }
  } catch (err) {
    alerts.push(`Failed to check unassigned orders: ${String(err)}`);
  }

  // ─── 3. Overdue deliveries (delivered_at is null but accepted 14+ days ago)
  try {
    const overdueCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: overdue } = await supabase
      .from('bookings')
      .select('id, reference, project_category, creator_id')
      .eq('status', 'accepted')
      .lt('accepted_at', overdueCutoff);

    if (overdue && overdue.length > 0) {
      alerts.push(`${overdue.length} overdue delivery/deliveries (accepted 14+ days ago, not yet delivered)`);
    }
  } catch (err) {
    alerts.push(`Failed to check overdue deliveries: ${String(err)}`);
  }

  // ─── Send alert email if any issues ───────────────────────────────────────
  if (alerts.length > 0) {
    try {
      await emailProvider.sendEmail({
        to: STUDIO.securityEmail,
        subject: `[Hourly Check] ${alerts.length} alert(s) — ${STUDIO.name}`,
        text: `Hourly health check at ${now.toLocaleString('en-ZA')}:\n\n${alerts.map((a, i) => `${i + 1}. ${a}`).join('\n\n')}`,
      });
    } catch { /* don't fail the cron */ }
  }

  console.log('[hourly-checks]', { checks, alertCount: alerts.length });

  return NextResponse.json({
    success: true,
    timestamp: now.toISOString(),
    checks,
    alertCount: alerts.length,
  });
}
