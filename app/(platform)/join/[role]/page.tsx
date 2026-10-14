export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Check, Clock } from 'lucide-react';
import { STUDIO } from '@/lib/constants';
import { loginUrl } from '@/lib/auth/next-path';
import { createClient } from '@/lib/supabase/server';
import { getIdentityFacts, getMyPersonRole, getRole } from '@/lib/supabase/queries/roles';
import { applicableRequirements, formatRolePrice, isAgeRequirement } from '@/lib/roles';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { ProfileMaker } from '@/components/roles/ProfileMaker';
import { InterestForm } from '@/components/roles/InterestForm';
import { RoleIcon } from '@/components/roles/RoleIcon';

interface Props {
  params: Promise<{ role: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { role: slug } = await params;
  const role = await getRole(slug);
  return buildPageMetadata({
    title: role ? `Join as ${role.name.toLowerCase()}` : 'Join',
    description: role ? `${role.description} Join ${STUDIO.shortName} free.` : `Join ${STUDIO.shortName}.`,
    path: `/join/${slug}`,
    noIndex: true,
  });
}

/**
 * The guided profile maker for one role. Signed out: what it takes, in plain
 * words, then sign in. Signed in: the maker (components/roles/ProfileMaker).
 */
export default async function JoinRolePage({ params }: Props) {
  const { role: slug } = await params;
  const role = await getRole(slug);
  if (!role) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const header = (
    <div className="mb-8">
      <Link href="/join" className="inline-flex items-center gap-2 min-h-[44px] text-sm text-neutral-400 hover:text-white mb-4">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> All kinds of work
      </Link>
      <div className="flex items-center gap-3">
        <span className="flex items-center justify-center w-12 h-12 rounded-full bg-accent-gold/10 text-accent-gold">
          <RoleIcon group={role.role_group} />
        </span>
        <div>
          <h1 className="text-3xl font-display font-medium text-white">{role.name}</h1>
          <p className="text-sm text-neutral-400">{role.description}</p>
        </div>
      </div>
    </div>
  );

  if (role.status !== 'live') {
    return (
      <div className="pt-28 pb-20 px-4">
        <div className="max-w-lg mx-auto">
          {header}
          <p className="flex items-center gap-2 text-neutral-300 mb-4">
            <Clock className="w-4 h-4 text-accent-gold" aria-hidden="true" /> Coming soon. Leave your number and we will tell you when it opens.
          </p>
          <InterestForm roleSlug={role.slug} roleName={role.name} />
        </div>
      </div>
    );
  }

  if (!user) {
    const docs = applicableRequirements(role.legal_requirements, Object.fromEntries(role.legal_requirements.filter((r) => r.when).map((r) => [r.when as string, true]))).filter((r) => !isAgeRequirement(r));
    return (
      <div className="pt-28 pb-20 px-4">
        <div className="max-w-lg mx-auto">
          {header}
          <h2 className="text-xl text-white mb-3">How it works</h2>
          <ol className="space-y-3 mb-6">
            {[
              'Sign in or make a free account.',
              ...(docs.length ? [`Take a photo of what the law needs: ${docs.map((d) => d.label.toLowerCase()).join(', ')}.`] : []),
              ...role.proof_task.filter((s) => s.min > 0).map((s) => `${s.title}: ${s.help}`),
              `Set your price. Most people charge about ${formatRolePrice(role.pricing_unit, role.suggested_price_cents.typical, role.suggested_price_cents.per_km)}.`,
              'Send it. A person on our team checks it, then clients can book you.',
            ].map((t, i) => (
              <li key={t} className="flex items-start gap-3 text-neutral-300">
                <span className="flex items-center justify-center w-7 h-7 shrink-0 rounded-full border border-accent-gold/40 text-accent-gold text-xs font-mono">{i + 1}</span>
                <span className="pt-0.5">{t}</span>
              </li>
            ))}
          </ol>
          {role.min_age !== null && (
            <p className="flex items-center gap-2 text-sm text-neutral-400 mb-6">
              <Check className="w-4 h-4 text-accent-gold" aria-hidden="true" /> {role.min_age} or older.
            </p>
          )}
          <Link href={loginUrl(`/join/${role.slug}`)} className="w-full min-h-[52px] px-6 bg-accent-gold text-black text-sm font-mono font-bold uppercase tracking-widest flex items-center justify-center">
            Start
          </Link>
          <details className="mt-8 border-t border-white/10 pt-4">
            <summary className="min-h-[44px] flex items-center cursor-pointer text-sm text-neutral-300">What our team checks</summary>
            <p className="text-sm text-neutral-400 whitespace-pre-line mt-2">{role.guidelines}</p>
          </details>
        </div>
      </div>
    );
  }

  const [mine, identity] = await Promise.all([getMyPersonRole(supabase, user.id, role.slug).catch(() => null), getIdentityFacts(user.id)]);

  return (
    <div className="pt-28 pb-10 px-4">
      <div className="max-w-lg mx-auto">
        {header}
        {role.existing_flow_href && !mine && (
          <p className="text-sm text-neutral-400 mb-6 border border-white/10 p-3">
            Already set up as a creator here? Your creator profile stays as it is.{' '}
            <Link href={role.existing_flow_href} className="text-accent-gold underline underline-offset-4">
              Go to creator set-up
            </Link>
          </p>
        )}
        <ProfileMaker role={role} initialPersonRole={mine?.personRole ?? null} initialEvidence={mine?.evidence ?? []} identity={{ verified: identity.identityVerified, status: identity.verificationStatus, dateOfBirthFromId: identity.dateOfBirthFromId }} />
        <details className="mt-10 border-t border-white/10 pt-4">
          <summary className="min-h-[44px] flex items-center cursor-pointer text-sm text-neutral-300">What our team checks</summary>
          <p className="text-sm text-neutral-400 whitespace-pre-line mt-2">{role.guidelines}</p>
        </details>
      </div>
    </div>
  );
}
