export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getFlag } from '@/lib/features';
import { listPlans, type PlanListItem } from '@/lib/projects/live';

export const metadata = { title: 'My plans' };

/**
 * The client's plans (Ubunye plans, flag ubunye_projects; off: 404). A plan
 * is made in the chat when an outcome needs several parts, and only once
 * the client approves it.
 */
export default async function PlansPage() {
  if (!(await getFlag('ubunye_projects'))) notFound();
  const user = await auth.getUser();
  if (!user) redirect('/login?next=/dashboard/plans');

  let plans: PlanListItem[] = [];
  let failed = false;
  try {
    plans = await listPlans(user.id);
  } catch {
    failed = true;
  }

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-lg font-display font-medium uppercase text-white">My plans</h2>
        <p className="text-xs font-mono text-neutral-400 mt-2">Everything one shoot or event needs, and where each part stands.</p>
      </div>
      {failed ? (
        <p role="alert" className="text-sm text-neutral-400">We could not load your plans just now. Try again in a moment.</p>
      ) : plans.length === 0 ? (
        <div className="border border-white/10 p-6 text-sm text-neutral-400">
          <p>No plans yet. When something needs more than one part, like a videographer and lights for a music video, ask Ubunye and it can save it as a plan for you.</p>
          <Link href="/ubunye-ai-studio" className="mt-4 inline-flex min-h-[44px] items-center px-4 bg-[#D4A843] text-black text-xs font-mono font-bold uppercase tracking-widest">
            Ask Ubunye
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {plans.map((p) => (
            <li key={p.id}>
              <Link href={`/dashboard/plans/${p.id}`} className="block border border-white/10 p-4 hover:border-[#D4A843]/40 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-display text-white">{p.title}</p>
                  <span className={`shrink-0 text-[11px] font-mono uppercase tracking-widest ${p.status === 'open' ? 'text-[#D4A843]' : 'text-neutral-500'}`}>
                    {p.status === 'open' ? 'Open' : 'Closed'}
                  </span>
                </div>
                {p.briefLine && <p className="mt-1 text-sm text-neutral-400">{p.briefLine}</p>}
                <p className="mt-1 text-xs font-mono text-neutral-500">{p.partCount} part{p.partCount === 1 ? '' : 's'}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
