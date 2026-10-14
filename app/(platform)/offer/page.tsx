export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { RENTAL_CATEGORIES, STUDIO } from '@/lib/constants';
import { getFlag } from '@/lib/features';
import { loginUrl } from '@/lib/auth/next-path';
import { createClient } from '@/lib/supabase/server';
import { getRoles } from '@/lib/supabase/queries/roles';
import { matchCandidates, skillsAsText } from '@/lib/roles';
import { OFFER_PATH } from '@/lib/welcome';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { OfferStep } from '@/components/roles/OfferStep';

export const metadata: Metadata = buildPageMetadata({
  title: 'Offer',
  description: `Offer your skills, gear or vehicle on ${STUDIO.shortName}. No portfolio needed.`,
  path: OFFER_PATH,
  noIndex: true,
});

/**
 * OFFER, the describe step (roles_v1). Sign-up happens once, here, the first
 * time: /join, /onboarding and "offer" on the home page all land here.
 * Skills already on the account are matched straight away, never assigned.
 */
export default async function OfferPage() {
  if (!(await getFlag('roles_v1'))) notFound();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(loginUrl(OFFER_PATH));

  const [roles, profileRes] = await Promise.all([
    getRoles(),
    supabase.from('profiles').select('skills, specializations').eq('id', user.id).maybeSingle(),
  ]);
  const plain = roles.map((r) => ({ slug: r.slug, name: r.name, description: r.description, status: r.status, role_group: r.role_group }));

  return (
    <OfferStep
      roles={plain}
      candidates={matchCandidates(plain, RENTAL_CATEGORIES)}
      initialText={skillsAsText(profileRes.data?.skills, profileRes.data?.specializations)}
    />
  );
}
