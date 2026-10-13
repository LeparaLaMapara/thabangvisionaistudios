export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { validateCronAuth } from '@/lib/cron/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';

/**
 * AI Budget Checks — runs every 6 hours
 *
 * Checks monthly AI token spend against budget.
 * Sends alert email at 80% and 100% thresholds.
 * Deduplicates alerts per billing period + threshold.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const supabase = createAdminClient();
  const now = new Date();
  const alerts: string[] = [];

  const { monthlyBudgetZAR, alertThresholds } = STUDIO.ai.budget;

  // Current billing period (YYYY-MM)
  const period = now.toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' }).slice(0, 7);
  const monthStart = `${period}-01T00:00:00+02:00`;

  // ─── 1. Aggregate monthly AI spend ──────────────────────────────────────────
  let monthlySpend = 0;
  let totalTokens = 0;
  let requestCount = 0;

  try {
    const { data, error } = await supabase
      .from('ai_token_usage')
      .select('estimated_cost, total_tokens')
      .gte('created_at', monthStart);

    if (error) {
      alerts.push(`Failed to query ai_token_usage: ${error.message}`);
    } else if (data) {
      requestCount = data.length;
      for (const row of data) {
        monthlySpend += Number(row.estimated_cost) || 0;
        totalTokens += Number(row.total_tokens) || 0;
      }
    }
  } catch (err) {
    alerts.push(`AI usage query error: ${String(err)}`);
  }

  // ─── 2. Check thresholds ────────────────────────────────────────────────────
  const spendPercent = monthlyBudgetZAR > 0
    ? Math.round((monthlySpend / monthlyBudgetZAR) * 100)
    : 0;

  for (const threshold of alertThresholds) {
    if (spendPercent < threshold) continue;

    // Check if we already alerted for this period + threshold
    const { data: existing } = await supabase
      .from('ai_budget_alerts')
      .select('id')
      .eq('period', period)
      .eq('threshold', threshold)
      .single();

    if (existing) continue; // Already alerted

    // Record the alert
    await supabase.from('ai_budget_alerts').insert({
      period,
      threshold,
      spend: monthlySpend,
      budget: monthlyBudgetZAR,
    });

    const subject = threshold >= 100
      ? `[CRITICAL] AI budget EXCEEDED — ${spendPercent}% of R${monthlyBudgetZAR}`
      : `[Warning] AI budget at ${spendPercent}% — R${monthlySpend.toFixed(2)} of R${monthlyBudgetZAR}`;

    try {
      await emailProvider.sendEmail({
        to: STUDIO.securityEmail,
        subject: `${subject} — ${STUDIO.name}`,
        text: [
          `AI Budget Alert — ${period}`,
          '',
          `Spend:     R${monthlySpend.toFixed(2)} (${spendPercent}% of budget)`,
          `Budget:    R${monthlyBudgetZAR}`,
          `Threshold: ${threshold}%`,
          `Requests:  ${requestCount}`,
          `Tokens:    ${totalTokens.toLocaleString('en-ZA')}`,
          '',
          threshold >= 100
            ? 'ACTION REQUIRED: AI spend has exceeded the monthly budget. Consider reducing usage or increasing the budget.'
            : 'No action required yet — this is a heads-up alert.',
          '',
          `— ${STUDIO.name} Cron System`,
        ].join('\n'),
      });
    } catch { /* email is best-effort */ }

    alerts.push(`Sent ${threshold}% budget alert (R${monthlySpend.toFixed(2)} / R${monthlyBudgetZAR})`);
  }

  console.log('[ai-budget-checks]', {
    period,
    monthlySpend: monthlySpend.toFixed(2),
    budget: monthlyBudgetZAR,
    spendPercent,
    requestCount,
    totalTokens,
    alertsSent: alerts.length,
  });

  return NextResponse.json({
    success: true,
    timestamp: now.toISOString(),
    period,
    monthlySpend: Number(monthlySpend.toFixed(2)),
    budget: monthlyBudgetZAR,
    spendPercent,
    requestCount,
    totalTokens,
    alertsSent: alerts.length,
  });
}
