import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Bot } from 'lucide-react';
import { auth } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { loadTodayFacts } from '@/lib/admin/control-room/load';
import { buildToday, type HealthLight, type MoneyTile, type Tone } from '@/lib/admin/control-room/today';
import { UBUNYE_AGENTS } from '@/lib/agents/registry';
import { formatRand } from '@/lib/format/money';
import { NeedsList } from '@/components/admin/today/NeedsList';
import { MovementsBoard } from '@/components/admin/today/MovementsBoard';

export const metadata: Metadata = { title: 'Today' };

// Always live: this page answers "what is happening right now".
export const dynamic = 'force-dynamic';

const TONE_DOT: Record<Tone, string> = {
  good: 'bg-emerald-400',
  watch: 'bg-amber-400',
  bad: 'bg-red-500',
  quiet: 'bg-neutral-500',
};

const TONE_TEXT: Record<Tone, string> = {
  good: 'text-emerald-300',
  watch: 'text-amber-300',
  bad: 'text-red-300',
  quiet: 'text-neutral-400',
};

function HealthStrip({ lights }: { lights: HealthLight[] }) {
  // Only problems take space; everything that works folds into one line.
  const problems = lights.filter((l) => l.tone !== 'good');
  const fine = lights.filter((l) => l.tone === 'good');
  return (
    <div aria-label="Is anything broken?">
      {problems.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {problems.map((l) => {
            const body = (
              <>
                <span className={`mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${TONE_DOT[l.tone]}`} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-white">
                    {l.label}
                    <span className="sr-only">: {l.tone === 'bad' ? 'problem' : 'watch'}</span>
                  </span>
                  <span className="block text-xs leading-snug text-neutral-400">{l.detail}</span>
                </span>
              </>
            );
            return (
              <li key={l.label}>
                {l.href ? (
                  <Link href={l.href} className="flex h-full gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3 hover:border-white/20">
                    {body}
                  </Link>
                ) : (
                  <div className="flex h-full gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {fine.length > 0 && (
        <p className="mt-2 flex items-center gap-2 text-xs text-neutral-400">
          <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
          {problems.length ? 'Working fine: ' : 'Everything is working: '}
          {fine.map((l) => l.label).join(', ')}.
        </p>
      )}
    </div>
  );
}

function MoneyStrip({ tiles }: { tiles: MoneyTile[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2 xl:grid-cols-4" aria-label="How is the business doing?">
      {tiles.map((t) => (
        <li key={t.label}>
          <Link href={t.href} className="group flex h-full flex-col rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 hover:border-white/20">
            <span className="text-xs text-neutral-400">{t.label}</span>
            <span className="mt-1 font-display text-2xl tabular-nums text-white sm:text-3xl">{t.value}</span>
            <span className={`mt-1 text-xs ${TONE_TEXT[t.tone]}`}>{t.note}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function TodayPage() {
  // The layout checks this too; this page reads with the service role, so it checks again itself.
  const user = await auth.getUser();
  if (!user) redirect('/login');
  if (!(await auth.isAdmin(user.id, user.email))) redirect('/dashboard');

  const facts = await loadTodayFacts(createAdminClient());
  const names = Object.fromEntries(Object.values(UBUNYE_AGENTS).map((a) => [a.id, a.name]));
  const view = buildToday(facts, names);

  const urgent = view.needs.filter((n) => n.urgency === 'now').length;
  const summary =
    view.needs.length === 0
      ? 'Nothing is waiting on you.'
      : `${view.needs.length} ${view.needs.length === 1 ? 'thing needs' : 'things need'} you${urgent ? `, ${urgent} urgent` : ''}.`;

  const activeAgents = view.agents.filter((a) => a.month > 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-10">
      <header className="mb-6">
        <p className="text-sm text-neutral-400">{view.dateLabel}</p>
        <h1 className="mt-1 font-display text-3xl text-white sm:text-4xl">{view.greeting}</h1>
        <p className="mt-2 text-base text-neutral-300">{summary}</p>
      </header>

      {/* On a phone the list of things to do comes before the numbers. */}
      <div className="flex flex-col gap-8">
      <HealthStrip lights={view.health} />
      <div className="order-last lg:order-none">
        <MoneyStrip tiles={view.money} />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="needs-h">
          <h2 id="needs-h" className="mb-3 font-display text-xl text-white">Needs you</h2>
          <NeedsList items={view.needs} />
          {view.notSetUp.length > 0 && (
            <p className="mt-3 text-xs leading-relaxed text-neutral-500">
              Not shown yet: {view.notSetUp.join(' and ')}. These turn on once the waiting database updates are applied.
            </p>
          )}
        </section>

        <div className="space-y-6">
          <MovementsBoard items={view.movements} />

          <section aria-labelledby="ai-h" className="rounded-2xl border border-white/10 bg-white/[0.02]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h2 id="ai-h" className="flex items-center gap-2 font-display text-lg text-white">
                <Bot className="h-5 w-5 text-accent-gold" aria-hidden="true" /> AI helpers
              </h2>
              <Link href="/admin/ai" className="inline-flex min-h-[36px] items-center gap-1 text-sm text-neutral-400 hover:text-white">
                Details <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            <div className="px-4 py-4">
              {view.ai ? (
                <>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-neutral-300">Spent this month</span>
                    <span className="tabular-nums text-white">
                      {formatRand(view.ai.spent)} <span className="text-neutral-500">of {formatRand(view.ai.budget)}</span>
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10" role="img" aria-label={`${Math.round(view.ai.ratio * 100)}% of the monthly AI limit used`}>
                    <div
                      className={`h-full rounded-full ${view.ai.ratio >= 1 ? 'bg-red-500' : view.ai.ratio >= 0.8 ? 'bg-amber-400' : 'bg-accent-gold'}`}
                      style={{ width: `${Math.min(100, Math.max(2, view.ai.ratio * 100))}%` }}
                    />
                  </div>
                </>
              ) : (
                <p className="text-sm text-neutral-400">Could not read this month&apos;s AI spend.</p>
              )}
              <ul className="mt-4 space-y-2">
                {(activeAgents.length ? activeAgents : view.agents.slice(0, 3)).slice(0, 5).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-neutral-300">{a.name}</span>
                    <span className="flex-shrink-0 tabular-nums text-neutral-400">
                      {a.today} today · {a.month} this month
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-neutral-500">Counts are conversations people had with each helper.</p>
            </div>
          </section>

          <section aria-labelledby="latest-h" className="rounded-2xl border border-white/10 bg-white/[0.02]">
            <h2 id="latest-h" className="border-b border-white/10 px-4 py-3 font-display text-lg text-white">Latest</h2>
            {view.activity.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-neutral-400">No activity yet.</p>
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {view.activity.map((a) => (
                  <li key={a.id}>
                    <Link href={a.href} className="flex min-h-[48px] items-center justify-between gap-3 px-4 py-2.5 hover:bg-white/[0.03]">
                      <span className="min-w-0 truncate text-sm text-neutral-200">{a.text}</span>
                      <span className="flex-shrink-0 text-xs text-neutral-500">{a.ago}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
      </div>
    </div>
  );
}
