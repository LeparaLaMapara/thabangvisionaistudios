import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { STUDIO } from '@/lib/constants';
import { OWNER_FUNNEL, RENTER_FUNNEL, funnelReport, type FunnelStage } from '@/lib/core/analytics/funnel';
import { loadFunnelCounts } from '@/lib/analytics/funnel-server';

export const metadata: Metadata = { title: 'Funnel — Admin' };
export const dynamic = 'force-dynamic';

const PERIODS = [7, 30, 90] as const;

/**
 * Where people drop out of renting and listing (spec §9.6). Counts come from
 * funnel events, which hold ids and codes only.
 */
export default async function FunnelPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const auth = await requireAdmin();
  if (auth.error) redirect('/');
  const { days: raw } = await searchParams;
  const days = PERIODS.find((d) => String(d) === raw) ?? 30;
  const since = new Date(Date.now() - days * 86_400_000);

  let counts: Awaited<ReturnType<typeof loadFunnelCounts>> | null = null;
  let failed = false;
  try {
    counts = await loadFunnelCounts(since);
  } catch {
    failed = true;
  }

  const table = (title: string, stages: readonly { stage: FunnelStage; label: string }[], by: 'people' | 'events') => {
    const rows = funnelReport(stages, counts?.[by] ?? {});
    return (
      <section className="mb-10" aria-labelledby={`h-${title}`}>
        <h2 id={`h-${title}`} className="font-display text-lg text-white mb-3">{title}</h2>
        <table className="w-full font-mono text-sm">
          <thead>
            <tr className="text-left text-neutral-400 border-b border-neutral-800">
              <th scope="col" className="py-2 pr-4 font-normal">Stage</th>
              <th scope="col" className="py-2 pr-4 font-normal text-right">{by === 'people' ? 'Accounts' : 'Events'}</th>
              <th scope="col" className="py-2 font-normal text-right">From previous</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.stage} className="border-b border-neutral-900 text-neutral-200">
                <td className="py-2 pr-4">{r.label}</td>
                <td className="py-2 pr-4 text-right">{r.count}</td>
                <td className="py-2 text-right text-neutral-400">{r.fromPrevious === null ? '—' : `${r.fromPrevious}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  };

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10">
      <header className="mb-8">
        <h1 className="text-2xl md:text-3xl font-display text-white tracking-tight">Funnel</h1>
        <p className="text-sm text-neutral-400 mt-2">
          How far people get when renting and listing gear, over the last {days} days. Only account ids and listing ids are recorded;
          events are deleted after {STUDIO.analytics.funnelRetentionDays} days.
        </p>
        <nav aria-label="Period" className="mt-4 flex gap-2">
          {PERIODS.map((d) => (
            <a
              key={d}
              href={`/admin/funnel?days=${d}`}
              aria-current={d === days ? 'page' : undefined}
              className={`inline-flex min-h-[44px] items-center rounded-md border px-4 font-mono text-sm ${d === days ? 'border-[#D4A843] text-[#D4A843]' : 'border-neutral-700 text-neutral-300'}`}
            >
              {d} days
            </a>
          ))}
        </nav>
      </header>

      {failed && <p role="alert" className="mb-6 text-red-400">Could not load funnel events just now. Reload to try again.</p>}
      {counts?.truncated && <p className="mb-6 text-neutral-400">Showing the first 50,000 events of this period.</p>}

      {table('Renting: viewed listings (all visitors)', RENTER_FUNNEL.slice(0, 2), 'events')}
      {table('Renting: signed-in accounts', RENTER_FUNNEL, 'people')}
      {table('Listing gear: owners', OWNER_FUNNEL, 'people')}
    </div>
  );
}
