export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BadgeCheck } from 'lucide-react';
import { getFlag } from '@/lib/features';
import { ROLES_POLICY, STUDIO } from '@/lib/constants';
import { getRoles, listApprovedProfiles } from '@/lib/supabase/queries/roles';
import { formatRolePrice, jobsLine } from '@/lib/roles';
import { buildPageMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = buildPageMetadata({
  title: 'People to book',
  description: `Make-up artists, models, drivers and camera people on ${STUDIO.shortName}.`,
  path: '/people',
  noIndex: true,
});

interface Props {
  searchParams: Promise<{ role?: string }>;
}

/** Approved role profiles, every one in the same card. */
export default async function PeoplePage({ searchParams }: Props) {
  if (!(await getFlag('roles_v1'))) notFound();
  const { role: roleParam } = await searchParams;
  const roles = (await getRoles()).filter((r) => r.status === 'live');
  const active = roles.find((r) => r.slug === roleParam)?.slug;
  const cards = await listApprovedProfiles(active);

  return (
    <div className="pt-28 pb-20 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-4xl font-display font-medium text-white mb-6">People to book</h1>
        <nav aria-label="Kinds of work" className="flex gap-2 overflow-x-auto pb-2 mb-8 -mx-4 px-4">
          <Link href="/people" className={`shrink-0 min-h-[44px] px-4 flex items-center border text-sm ${!active ? 'border-accent-gold text-accent-gold' : 'border-white/15 text-neutral-300'}`}>
            Everyone
          </Link>
          {roles.map((r) => (
            <Link
              key={r.slug}
              href={`/people?role=${r.slug}`}
              className={`shrink-0 min-h-[44px] px-4 flex items-center border text-sm ${active === r.slug ? 'border-accent-gold text-accent-gold' : 'border-white/15 text-neutral-300'}`}
            >
              {r.name}
            </Link>
          ))}
        </nav>

        {cards.length === 0 ? (
          <p className="text-neutral-400">
            Nobody here yet. <Link href="/join" className="text-accent-gold underline underline-offset-4">Join</Link>
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => (
              <li key={c.id}>
                <Link href={`/people/${c.id}`} className="group block border border-white/10 hover:border-accent-gold/60 transition-colors">
                  <div className="aspect-[4/5] bg-neutral-900 overflow-hidden">
                    {c.cover && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.cover} alt="" className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform" loading="lazy" />
                    )}
                  </div>
                  <div className="p-4">
                    <p className="text-xs font-mono uppercase tracking-widest text-accent-gold mb-1">{c.roleName}</p>
                    <p className="text-white text-lg flex items-center gap-2">
                      {c.name}
                      {c.verified && <BadgeCheck className="w-4 h-4 text-accent-gold" aria-label={ROLES_POLICY.copy.verified} />}
                    </p>
                    {c.headline && <p className="text-sm text-neutral-400 line-clamp-1">{c.headline}</p>}
                    <p className="text-xs text-neutral-500 mt-2">{jobsLine(c.confirmedJobs)}</p>
                    {c.priceCents !== null && <p className="text-sm text-neutral-200 mt-1">{formatRolePrice(c.unit, c.priceCents, c.perKmCents)}</p>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
