export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { auth } from '@/lib/auth';
import { getFlag } from '@/lib/features';
import { getProjectView, listLinkableParts, type LinkablePart, type ProjectView } from '@/lib/projects/live';
import { AddToPlan, ClosePlan } from '@/components/plans/PlanActions';
import { MovePlan } from '@/components/plans/MovePlan';
import { saToday } from '@/lib/dates/johannesburg';
import type { PartView } from '@/lib/core/projects/plan';

export const metadata = { title: 'Plan' };

const DOT: Record<PartView['tone'], string> = {
  done: 'bg-emerald-400',
  waiting: 'bg-[#D4A843]',
  todo: 'bg-white',
  blocked: 'bg-neutral-600',
};

const TONE_WORDS: Record<PartView['tone'], string> = {
  done: 'Done',
  waiting: 'Waiting',
  todo: 'To do',
  blocked: 'Not possible now',
};

/**
 * One plan: the title, the brief in one line, every part with its live state
 * in plain words, and the one next thing to do. Status, price and dates are
 * read now from the bookings and requests the plan points at
 * (lib/projects/live.ts). Flag off, or not theirs: 404.
 */
export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await getFlag('ubunye_projects'))) notFound();
  const user = await auth.getUser();
  const { id } = await params;
  if (!user) redirect(`/login?next=/dashboard/plans/${encodeURIComponent(id)}`);

  let plan: ProjectView | null;
  try {
    plan = await getProjectView(user.id, id);
  } catch {
    return (
      <div>
        <BackLink />
        <p role="alert" className="text-sm text-neutral-400">We could not load this plan just now. Try again in a moment.</p>
      </div>
    );
  }
  if (!plan) notFound();

  let linkable: LinkablePart[] = [];
  if (plan.status === 'open') {
    try {
      linkable = await listLinkableParts(user.id);
    } catch {
      linkable = [];
    }
  }

  return (
    <div className="max-w-2xl">
      <BackLink />
      <div className="mb-6">
        <p className="text-[11px] font-mono uppercase tracking-widest text-[#D4A843]">{plan.status === 'open' ? 'Plan' : 'Closed plan'}</p>
        <h1 className="mt-1 text-2xl font-display font-medium text-white">{plan.title}</h1>
        {plan.briefLine && <p className="mt-2 text-sm text-neutral-400">{plan.briefLine}</p>}
      </div>

      {plan.next && (
        <div className="mb-8 border border-[#D4A843]/40 bg-[#D4A843]/5 p-4">
          <p className="text-[11px] font-mono uppercase tracking-widest text-[#D4A843]">Next</p>
          <p className="mt-1 text-neutral-200">{plan.next.line}</p>
          <Link href={plan.next.href} className="mt-3 inline-flex min-h-[44px] items-center px-4 bg-[#D4A843] text-black text-xs font-mono font-bold uppercase tracking-widest">
            {plan.next.label}
          </Link>
        </div>
      )}

      <ul className="divide-y divide-white/10 border-y border-white/10">
        {plan.parts.map((p) => (
          <li key={p.itemId} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className={`mt-2 h-2 w-2 shrink-0 rounded-full ${DOT[p.tone]}`} />
              <div>
                <p className="text-neutral-200">
                  <span className="sr-only">{TONE_WORDS[p.tone]}: </span>
                  {p.line}
                </p>
                {p.step && p.tone === 'todo' && <p className="mt-1 text-xs text-neutral-500">{p.step}</p>}
                {p.due && plan.status === 'open' && (
                  <p className={`mt-1 text-xs font-mono ${p.due.late ? 'text-amber-200' : 'text-[#D4A843]'}`}>{p.due.words}</p>
                )}
              </div>
            </div>
            {p.next && plan.status === 'open' && (
              <Link href={p.next.href} className="inline-flex min-h-[44px] shrink-0 items-center justify-center px-4 border border-white/15 text-neutral-200 text-xs font-mono font-bold uppercase tracking-widest hover:border-[#D4A843]/50">
                {p.next.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-neutral-500">Each part is requested, booked and paid on its own. A plan books nothing by itself.</p>

      {plan.steps.length > 0 && (
        <section aria-labelledby="plan-steps" className="mt-8">
          <h2 id="plan-steps" className="text-sm font-mono uppercase tracking-widest text-neutral-400">Timeline</h2>
          <ol className="mt-3 space-y-2">
            {plan.steps.map((s) => (
              <li key={`${s.iso}-${s.label}`} className={`flex flex-col gap-0.5 text-sm sm:flex-row sm:gap-3 ${s.past ? 'text-neutral-500' : 'text-neutral-200'}`}>
                <span className="font-mono text-xs text-[#D4A843] sm:w-56 sm:shrink-0">{s.when}</span>
                <span>{s.label}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {plan.status === 'open' && <AddToPlan planId={plan.id} parts={linkable} />}

      {plan.status === 'open' && <MovePlan planId={plan.id} minDate={saToday()} />}

      <div className="mt-10 flex flex-col gap-4 border-t border-white/10 pt-6 sm:flex-row sm:items-start sm:justify-between">
        {plan.sourceConversationId ? (
          <Link href={`/ubunye-ai-studio?c=${plan.sourceConversationId}`} className="inline-flex min-h-[44px] items-center text-sm text-[#D4A843] underline underline-offset-2">
            Back to the chat
          </Link>
        ) : (
          <span />
        )}
        {plan.status === 'open' && <ClosePlan planId={plan.id} />}
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/dashboard/plans" className="mb-4 inline-flex min-h-[44px] items-center gap-2 text-sm text-neutral-400 hover:text-white">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All plans
    </Link>
  );
}
