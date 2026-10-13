export const dynamic = 'force-dynamic';

export const metadata = buildPageMetadata({
  title: 'Set Up Your Profile',
  description: 'Set up your creator profile.',
  path: '/onboarding',
  noIndex: true,
});

import OnboardingFlow from '@/components/onboarding/OnboardingFlow';
import { buildPageMetadata } from '@/lib/seo/metadata';

export default function OnboardingPage() {
  return <OnboardingFlow />;
}
