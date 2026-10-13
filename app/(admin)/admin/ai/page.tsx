import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { UBUNYE_AGENTS } from '@/lib/agents/registry';
import { STUDIO } from '@/lib/constants';
import { formatRand } from '@/lib/format/money';
import { saDay } from '@/lib/admin/control-room/today';

export const metadata: Metadata = { title: 'AI helpers and spend' };
export const dynamic = 'force-dynamic';

const COST_TIER: Record<string, string> = { free: 'Free model', low: 'Cheap', medium: 'Costs money per use' };

/**
 * The AI helpers as a staff list: what each one does, how much it was used,
 * and what AI cost this month against the limit.
 */
export default async function AiHelpersPage() {
  const user = await auth.getUser();
  if (!user) redirect('/login');
  if (!(await auth.isAdmin(user.id, user.email))) redirect('/dashboard');

  const db = createAdminClient();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const since30 = new Date(now.getTime() - 29 * 86_400_000);
  const from = (monthStart < since30 ? monthStart : since30).toISOString();

  const [usage, chats] = await Promise.all([
    db.from('ai_token_usage').select('model, estimated_cost, total_tokens, created_at').gte('created_at', from).limit(20000),
    db.from('chat_conversations').select('agent_id, started_at').gte('started_at', from).limit(20000),
  ]);

  const usageRows = (usage.data ?? []) as { model: string | null; estimated_cost: number | null; total_tokens: number | null; created_at: string }[];
  const chatRows = (chats.data ?? []) as { agent_id: string | null; started_at: string }[];

  const budget = STUDIO.ai.budget.monthlyBudgetZAR;
  const monthIso = monthStart.toISOString();
  const monthRows = usageRows.filter((r) => r.created_at >= monthIso);
  const spent = monthRows.reduce((s, r) => s + (Number(r.estimated_cost) || 0), 0);
  const ratio = budget > 0 ? spent / budget : 0;

  // Spend per day for the last 30 days.
  const days: { day: string; cost: number }[] = [];
  for (let i = 29; i >= 0; i--) days.push({ day: saDay(new Date(now.getTime() - i * 86_400_000)), cost: 0 });
  const byDay = new Map(days.map((d) => [d.day, d]));
  for (const r of usageRows) {
    const d = byDay.get(saDay(new Date(r.created_at)));
    if (d) d.cost += Number(r.estimated_cost) || 0;
  }
  const peak = Math.max(...days.map((d) => d.cost), 0.01);

  // Spend per model this month.
  const models = new Map<string, { cost: number; calls: number }>();
  for (const r of monthRows) {
    const key = r.model ?? 'unknown';
    const m = models.get(key) ?? { cost: 0, calls: 0 };
    m.cost += Number(r.estimated_cost) || 0;
    m.calls++;
    models.set(key, m);
  }

  // Conversations per helper this month and today.
  const today = saDay(now);
  const perAgent = new Map<string, { month: number; today: number }>();
  for (const c of chatRows) {
    if (c.started_at < monthIso) continue;
    const id = c.agent_id ?? 'assistant';
    const a = perAgent.get(id) ?? { month: 0, today: 0 };
    a.month++;
    if (saDay(new Date(c.started_at)) === today) a.today++;
    perAgent.set(id, a);
  }

  const agents = Object.values(UBUNYE_AGENTS).map((a) => ({ ...a, use: perAgent.get(a.id) ?? { month: 0, today: 0 } }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-10">
      <header>
        <p className="text-sm text-neutral-400">Money</p>
        <h1 className="mt-1 font-display text-3xl text-white">AI helpers and spend</h1>
        <p className="mt-2 max-w-2xl text-neutral-300">
          The site has {agents.length} AI helpers. They answer customers, help with bookings and write descriptions. When this month&apos;s
          limit is used up, they stop until the next month.
        </p>
      </header>

      <section aria-labelledby="spend-h" className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 id="spend-h" className="text-sm text-neutral-400">Spent this month</h2>
        <p className="mt-1 font-display text-4xl tabular-nums text-white">
          {formatRand(spent, { decimals: spent < 100 })} <span className="text-lg text-neutral-500">of {formatRand(budget)}</span>
        </p>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/10" role="img" aria-label={`${Math.round(ratio * 100)}% of the monthly limit used`}>
          <div
            className={`h-full rounded-full ${ratio >= 1 ? 'bg-red-500' : ratio >= 0.8 ? 'bg-amber-400' : 'bg-accent-gold'}`}
            style={{ width: `${Math.min(100, Math.max(1, ratio * 100))}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-neutral-400">
          {ratio >= 1
            ? 'The limit is used up. The helpers are paused until next month.'
            : `${Math.round(ratio * 100)}% used. You get an email at ${STUDIO.ai.budget.alertThresholds.join('% and ')}%.`}
        </p>

        <h3 className="mt-6 text-sm text-neutral-400">Last 30 days</h3>
        <div className="mt-2 flex h-24 items-end gap-[3px]" role="img" aria-label="AI spend per day over the last 30 days">
          {days.map((d) => (
            <div
              key={d.day}
              title={`${d.day}: ${formatRand(d.cost, { decimals: true })}`}
              className="flex-1 rounded-sm bg-accent-gold/70"
              style={{ height: `${Math.max(2, (d.cost / peak) * 100)}%`, opacity: d.cost > 0 ? 1 : 0.25 }}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="helpers-h" className="mt-8">
        <h2 id="helpers-h" className="mb-3 font-display text-xl text-white">The helpers</h2>
        <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
          {agents.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:gap-6">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium text-white">{a.name}</p>
                <p className="text-sm text-neutral-400">{a.description}</p>
              </div>
              <div className="flex flex-shrink-0 gap-6 text-sm">
                <span className="text-neutral-300">
                  <span className="tabular-nums text-white">{a.use.today}</span> today
                </span>
                <span className="text-neutral-300">
                  <span className="tabular-nums text-white">{a.use.month}</span> this month
                </span>
                <span className="w-36 text-neutral-500">{COST_TIER[a.costTier] ?? a.costTier}</span>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-neutral-500">
          Today and this month count conversations. Helpers that work behind the scenes (writing descriptions, reading photos) show
          their cost in the total above, not as conversations.
        </p>
      </section>

      {models.size > 0 && (
        <section aria-labelledby="models-h" className="mt-8">
          <h2 id="models-h" className="mb-3 font-display text-xl text-white">Cost by AI model this month</h2>
          <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
            {[...models.entries()]
              .sort((x, y) => y[1].cost - x[1].cost)
              .map(([model, m]) => (
                <li key={model} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                  <span className="truncate text-neutral-200">{model}</span>
                  <span className="flex-shrink-0 tabular-nums text-neutral-400">
                    {m.calls} uses · <span className="text-white">{formatRand(m.cost, { decimals: true })}</span>
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}
