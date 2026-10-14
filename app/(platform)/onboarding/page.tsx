export const dynamic = 'force-dynamic';

export const metadata = buildPageMetadata({
  title: 'Set Up Your Profile',
  description: 'Set up your creator profile.',
  path: '/onboarding',
  noIndex: true,
});

import { redirect } from 'next/navigation';
import OnboardingFlow from '@/components/onboarding/OnboardingFlow';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { getFlag } from '@/lib/features';
import { offerRolePath } from '@/lib/welcome';
import { CREATOR_FLOW_ROLE } from '@/lib/roles';

/**
 * Creator onboarding. With roles_v1 on, it is a deep link into Offer: the
 * photographer profile maker, which carries over what the person already
 * entered (bio, area, specialisations, portfolio photos).
 */
export default async function OnboardingPage() {
  if (await getFlag('roles_v1')) redirect(offerRolePath(CREATOR_FLOW_ROLE));
  return <OnboardingFlow />;
}
