import Link from 'next/link';
import { ArrowLeft, Clock } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getIdentityFacts, getMyPersonRole } from '@/lib/supabase/queries/roles';
import { profilePrefill, type Role } from '@/lib/roles';
import { ProfileMaker } from './ProfileMaker';
import { InterestForm } from './InterestForm';
import { RoleIcon } from './RoleIcon';

/**
 * The profile maker inside Offer (/offer/<slug>). Server
 * component: loads the person's draft, their ID check state and what their
 * existing profile already says, so nobody types anything twice.
 */
export async function RoleMakerScreen({ role, supabase, userId }: { role: Role; supabase: SupabaseClient; userId: string }) {
  const header = (
    <div className="mb-8">
      <Link href="/offer" className="inline-flex items-center gap-2 min-h-[44px] text-sm text-neutral-400 hover:text-white mb-4">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Choose other work
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

  const [mine, identity, profileRes] = await Promise.all([
    getMyPersonRole(supabase, userId, role.slug).catch(() => null),
    getIdentityFacts(userId),
    supabase.from('profiles').select('bio, crew_bio, location, city, specializations').eq('id', userId).maybeSingle(),
  ]);

  return (
    <div className="pt-28 pb-10 px-4">
      <div className="max-w-lg mx-auto">
        {header}
        <ProfileMaker
          role={role}
          initialPersonRole={mine?.personRole ?? null}
          initialEvidence={mine?.evidence ?? []}
          identity={{ verified: identity.identityVerified, status: identity.verificationStatus, dateOfBirthFromId: identity.dateOfBirthFromId }}
          prefill={profilePrefill(profileRes.data)}
        />
        <details className="mt-10 border-t border-white/10 pt-4">
          <summary className="min-h-[44px] flex items-center cursor-pointer text-sm text-neutral-300">What our team checks</summary>
          <p className="text-sm text-neutral-400 whitespace-pre-line mt-2">{role.guidelines}</p>
        </details>
      </div>
    </div>
  );
}
