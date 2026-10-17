export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFlag } from '@/lib/features';
import { EARN, ROLES_POLICY, STUDIO } from '@/lib/constants';
import { getRoles, heldProductions, listApprovedProfiles } from '@/lib/supabase/queries/roles';
import { getPublishedProductions } from '@/lib/supabase/queries/smartProductions';
import { formatRolePrice } from '@/lib/roles';
import { formatRand } from '@/lib/format/money';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { peopleWords } from '@/lib/roles/offered';
import { whatsappLink } from '@/lib/payments/eft';
import { PersonCardBody } from '@/components/roles/PersonCard';
import { parseRequestPrefill, planRequestQuery } from '@/lib/roles/request-prefill';
import { parsePlanLink } from '@/lib/core/projects/plan';
import { formatSaDay, saToday } from '@/lib/dates/johannesburg';

export const metadata: Metadata = buildPageMetadata({
  title: 'People',
  description: `People you can book for your shoot on ${STUDIO.shortName}. Chosen for their work.`,
  path: '/people',
  noIndex: true,
});

/** The message the WhatsApp link opens with, for anyone the page does not list. */
const PEOPLE_ASK_MESSAGE = 'Hi, I need someone for my shoot. My date is:';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * People (roles_v1): everyone bookable on one page, the photo and video
 * packages from /studio plus approved role profiles. Blind cards (equal
 * chance): role, area, code, work, price, record. Never a face or a name.
 *
 * From a plan ("Ask the next listed person"): the link carries the day, the
 * area, the plan and its need (all checked: lib/roles/request-prefill.ts,
 * parsePlanLink). Each card then also offers its request form, prefilled
 * and joined to the plan. Nothing is sent from here.
 */
export default async function PeoplePage({ searchParams }: Props) {
  if (!(await getFlag('roles_v1'))) notFound();
  const query = await searchParams;
  const roleParam = typeof query.role === 'string' ? query.role : undefined;
  const today = saToday();
  const prefill = parseRequestPrefill(query, today, { byDays: true });
  const plan = (await getFlag('ubunye_projects')) ? parsePlanLink(query) : { planId: null, needItemId: null };
  const forPlan = !!plan.planId;
  const requestQuery = forPlan ? planRequestQuery(prefill, plan) : '';
  const live = (await getRoles()).filter((r) => r.status === 'live');
  const [everyone, allPackages, held] = await Promise.all([listApprovedProfiles(), getPublishedProductions(), heldProductions()]);
  // Only kinds of work someone actually offers get a chip: an empty category is noise (owner, 2026-10-14).
  const roles = live.filter((r) => everyone.some((c) => c.roleSlug === r.slug));
  // Name only the kinds of work someone offers; one honest line for the rest.
  const words = peopleWords(roles, live);
  const active = roles.find((r) => r.slug === roleParam)?.slug;
  const cards = active ? everyone.filter((c) => c.roleSlug === active) : everyone;
  // A package whose work a profile holds is shown once, as that profile (092).
  const packages = active ? [] : allPackages.filter((p) => !held.has(p.id));

  return (
    <div className="pt-28 pb-20 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-4xl font-display font-medium text-white mb-2">People</h1>
        <p className="text-neutral-400 mb-6">{ROLES_POLICY.copy.blindNote}</p>
        {forPlan && (
          <p className="mb-6 border border-[#D4A843]/40 bg-[#D4A843]/5 p-4 text-sm text-neutral-200">
            For your plan{prefill.dates[0] ? `, ${formatSaDay(prefill.dates[0])}` : ''}: choose the next person and send the request. It joins your plan.
          </p>
        )}
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
          <h2 id="people-h" className="text-sm font-mono uppercase tracking-widest text-neutral-400 mb-3">{words.heading}</h2>
          {cards.length === 0 ? (
            <p className="text-neutral-400">
              Nobody here yet. <Link href={EARN.href} className="text-accent-gold underline underline-offset-4">{EARN.label}</Link>
            </p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((c) => (
                <li key={c.id}>
                  <Link href={`/people/${c.id}`} className="group block border border-white/10 hover:border-accent-gold/60 transition-colors">
                    <PersonCardBody
                      card={{
                        label: c.label,
                        roleName: c.roleName,
                        cover: c.cover,
                        verified: c.verified,
                        record: c.record,
                        headline: c.headline,
                        comesWith: c.comesWith,
                        priceText: c.priceCents !== null ? formatRolePrice(c.unit, c.priceCents, c.perKmCents) : null,
                      }}
                    />
                  </Link>
                  {forPlan && (
                    <Link href={`/people/${c.id}/request${requestQuery}`} className="mt-2 inline-flex min-h-[44px] items-center text-sm text-accent-gold underline underline-offset-4">
                      Request for your plan
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-8 text-neutral-300">
            {words.askLine}{' '}
            <a
              href={whatsappLink(PEOPLE_ASK_MESSAGE)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center text-accent-gold underline underline-offset-4"
            >
              WhatsApp us
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
