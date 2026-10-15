export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BadgeCheck, Package } from 'lucide-react';
import { getFlag } from '@/lib/features';
import { EARN, ROLES_POLICY, STUDIO } from '@/lib/constants';
import { getRoles, heldProductions, listApprovedProfiles } from '@/lib/supabase/queries/roles';
import { getPublishedProductions } from '@/lib/supabase/queries/smartProductions';
import { formatRolePrice } from '@/lib/roles';
import { formatRand } from '@/lib/format/money';
import { buildPageMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = buildPageMetadata({
  title: 'People',
  description: `Photo and video shoots, make-up artists, models and drivers on ${STUDIO.shortName}. Chosen for their work.`,
  path: '/people',
  noIndex: true,
});

interface Props {
  searchParams: Promise<{ role?: string }>;
}

/**
 * People (roles_v1): everyone bookable on one page, the photo and video
 * packages from /studio plus approved role profiles. Blind cards (equal
 * chance): role, area, code, work, price, record. Never a face or a name.
 */
export default async function PeoplePage({ searchParams }: Props) {
  if (!(await getFlag('roles_v1'))) notFound();
  const { role: roleParam } = await searchParams;
  const live = (await getRoles()).filter((r) => r.status === 'live');
  const [everyone, allPackages, held] = await Promise.all([listApprovedProfiles(), getPublishedProductions(), heldProductions()]);
  // Only kinds of work someone actually offers get a chip: an empty category is noise (owner, 2026-10-14).
  const roles = live.filter((r) => everyone.some((c) => c.roleSlug === r.slug));
  const active = roles.find((r) => r.slug === roleParam)?.slug;
  const cards = active ? everyone.filter((c) => c.roleSlug === active) : everyone;
  // A package whose work a profile holds is shown once, as that profile (092).
  const packages = active ? [] : allPackages.filter((p) => !held.has(p.id));

  return (
    <div className="pt-28 pb-20 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-4xl font-display font-medium text-white mb-2">People</h1>
        <p className="text-neutral-400 mb-6">{ROLES_POLICY.copy.blindNote}</p>
        {roles.length > 1 && (
        <nav aria-label="Kinds of work" className="flex gap-2 overflow-x-auto pb-2 mb-8 -mx-4 px-4">
          <Link href="/people" className={`shrink-0 min-h-[44px] px-4 flex items-center border text-sm ${!active ? 'border-accent-gold text-accent-gold' : 'border-white/15 text-neutral-300'}`}>
            Everyone
          </Link>
          {roles.map((r) => (
            <Link key={r.slug} href={`/people?role=${r.slug}`} className={`shrink-0 min-h-[44px] px-4 flex items-center border text-sm ${active === r.slug ? 'border-accent-gold text-accent-gold' : 'border-white/15 text-neutral-300'}`}>
              {r.name}
            </Link>
          ))}
        </nav>
        )}

        {packages.length > 0 && (
          <section className="mb-12" aria-labelledby="packages-h">
            <h2 id="packages-h" className="text-sm font-mono uppercase tracking-widest text-neutral-400 mb-3">Photo and video shoots</h2>
            <ul className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              {packages.slice(0, 8).map((p) => {
                const img = p.thumbnail_url ?? p.gallery?.[0]?.url ?? null;
                return (
                  <li key={p.id}>
                    <Link href={`/studio/${p.slug}`} className="block border border-white/10 hover:border-accent-gold/60">
                      <div className="aspect-square bg-neutral-900 overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {img && <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" />}
                      </div>
                      <div className="p-3">
                        <p className="text-sm text-white line-clamp-2">{p.title}</p>
                        {p.price ? <p className="text-xs text-neutral-400 mt-1">{formatRand(Number(p.price))}</p> : null}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section aria-labelledby="people-h">
          <h2 id="people-h" className="text-sm font-mono uppercase tracking-widest text-neutral-400 mb-3">Make-up, models, drivers and more</h2>
          {cards.length === 0 ? (
            <p className="text-neutral-400">
              Nobody here yet. <Link href={EARN.href} className="text-accent-gold underline underline-offset-4">{EARN.label}</Link>
            </p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((c) => (
                <li key={c.id}>
                  <Link href={`/people/${c.id}`} className="group block border border-white/10 hover:border-accent-gold/60 transition-colors">
                    <div className="aspect-[4/3] bg-neutral-900 overflow-hidden flex items-center justify-center">
                      {c.cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.cover} alt="" className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <span className="text-neutral-600 text-sm">{c.roleName}</span>
                      )}
                    </div>
                    <div className="p-4">
                      <p className="text-white flex items-center gap-2">
                        {c.label}
                        {c.verified && <BadgeCheck className="w-4 h-4 text-accent-gold shrink-0" aria-label={ROLES_POLICY.copy.verified} />}
                      </p>
                      {c.headline && <p className="text-sm text-neutral-400 line-clamp-1">{c.headline}</p>}
                      {c.comesWith && <p className="flex items-center gap-1 text-xs text-neutral-300 mt-1"><Package className="w-3.5 h-3.5 text-accent-gold" aria-hidden="true" /> Comes with: {c.comesWith}</p>}
                      <p className="text-xs text-neutral-500 mt-2">{c.record}</p>
                      {c.priceCents !== null && <p className="text-sm text-neutral-200 mt-1">{formatRolePrice(c.unit, c.priceCents, c.perKmCents)}</p>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
