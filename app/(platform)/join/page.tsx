export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { STUDIO } from '@/lib/constants';
import { getRoles } from '@/lib/supabase/queries/roles';
import { formatRolePrice } from '@/lib/roles';
import { RoleIcon } from '@/components/roles/RoleIcon';
import { InterestForm } from '@/components/roles/InterestForm';
import { buildPageMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = buildPageMetadata({
  title: 'Join',
  description: `Anyone can join ${STUDIO.shortName}. No portfolio or certificate needed: show your work in the app and get booked for shoots.`,
  path: '/join',
  noIndex: true,
});

/**
 * "What do you do?" The role catalogue from the database (migration 090).
 * Live roles open the profile maker; coming-soon roles take a number.
 * Reachable by URL; the nav entry is behind the `roles_v1` flag.
 */
export default async function JoinPage() {
  const roles = await getRoles();
  const live = roles.filter((r) => r.status === 'live');
  const soon = roles.filter((r) => r.status === 'coming_soon');

  return (
    <div className="pt-28 pb-20 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto">
        <p className="text-xs font-mono uppercase tracking-widest text-accent-gold mb-3">Join {STUDIO.shortName}</p>
        <h1 className="text-4xl sm:text-5xl font-display font-medium tracking-tight text-white mb-4">What do you do?</h1>
        <p className="text-neutral-300 text-lg leading-relaxed mb-2">
          Anyone can join. You do not need a portfolio or a certificate.
        </p>
        <p className="text-neutral-400 leading-relaxed mb-10">
          We help you show your work with your phone, in a few small steps. A person on our team checks it, then clients can book you.
        </p>

        {live.length === 0 ? (
          <p className="text-neutral-400">Nothing is open yet. Please check again soon.</p>
        ) : (
          <ul className="grid gap-3 mb-14">
            {live.map((r) => (
              <li key={r.slug}>
                <Link
                  href={`/join/${r.slug}`}
                  className="group flex items-center gap-4 p-4 sm:p-5 min-h-[72px] border border-white/10 bg-white/[0.02] hover:border-accent-gold/60 hover:bg-white/[0.04] transition-colors"
                >
                  <span className="flex items-center justify-center w-12 h-12 shrink-0 rounded-full bg-accent-gold/10 text-accent-gold">
                    <RoleIcon group={r.role_group} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-white text-lg font-medium">{r.name}</span>
                    <span className="block text-sm text-neutral-400">{r.description}</span>
                    <span className="block text-xs font-mono text-neutral-500 mt-1">
                      From about {formatRolePrice(r.pricing_unit, r.suggested_price_cents.typical, r.suggested_price_cents.per_km)}
                    </span>
                  </span>
                  <ArrowRight className="w-5 h-5 text-neutral-500 group-hover:text-accent-gold shrink-0" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}

        {soon.length > 0 && (
          <section aria-labelledby="soon-heading">
            <h2 id="soon-heading" className="text-sm font-mono uppercase tracking-widest text-neutral-400 mb-4">
              Coming soon
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {soon.map((r) => (
                <li key={r.slug} className="p-4 border border-white/10 bg-white/[0.01]">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="flex items-center justify-center w-10 h-10 shrink-0 rounded-full bg-white/5 text-neutral-400">
                      <RoleIcon group={r.role_group} className="w-5 h-5" />
                    </span>
                    <span>
                      <span className="block text-white">{r.name}</span>
                      <span className="block text-xs text-neutral-500">{r.description}</span>
                    </span>
                  </div>
                  <InterestForm roleSlug={r.slug} roleName={r.name} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-14 flex items-start gap-3 text-sm text-neutral-400 border-t border-white/10 pt-6">
          <ShieldCheck className="w-5 h-5 text-accent-gold shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            We only ask for documents the law needs for your kind of work. Most people need nothing more than the ID check everyone does.
          </span>
        </p>
      </div>
    </div>
  );
}
