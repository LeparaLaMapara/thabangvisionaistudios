export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { checkConsents, requiredConsents } from '@/lib/consent';
import { cleanNextPath, loginUrl } from '@/lib/auth/next-path';
import { OnboardingAcceptance } from '@/components/consent/OnboardingAcceptance';
import WelcomeChoices from './WelcomeChoices';
import { getFlag } from '@/lib/features';
import { WELCOME_CHOICES, WELCOME_CHOICES_ROLES } from '@/lib/welcome';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { STUDIO } from '@/lib/constants';

export const metadata = buildPageMetadata({
  title: 'Welcome',
  description: `Welcome to ${STUDIO.shortName}.`,
  path: '/welcome',
  noIndex: true,
});

/**
 * The first screen after signing up: one question, "What did you come to do?".
 *
 * Every new account used to land on a creator onboarding ("Join the Network,
 * upload 2 portfolio photos") or a dashboard that said "Welcome back", even
 * for someone who only wanted to rent a camera for the weekend. None of the
 * first 32 real signups got further. This asks once and sends each person to
 * the thing they came for.
 *
 * Sign-in sends people here with `?next=` when their acceptance of the
 * current Terms and Privacy Policy is not on record. After the one tap they
 * carry on to `next` (the gear page or booking they were on) instead of
 * being asked what they came for.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = cleanNextPath(typeof params.next === 'string' ? params.next : null);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // /welcome itself is never a sign-in destination: sign-in comes back here
  // anyway when acceptance is missing or nothing else says where to go.
  if (!user) redirect(loginUrl(next));

  const meta = (user.user_metadata ?? {}) as { full_name?: string; name?: string };
  const firstName = (meta.full_name || meta.name || '').split(' ')[0] || null;

  // Accept the current Terms and Privacy Policy once. If the consent store
  // cannot be read (e.g. migration 068 not applied yet), let the person
  // through rather than trap them on a screen whose save would fail;
  // checkout checks again.
  const consent = await checkConsents(supabase, user.id, requiredConsents('onboarding'));
  if (consent.status === 'missing') {
    const source = user.app_metadata?.provider === 'email' ? 'signup' : 'oauth_onboarding';
    return <OnboardingAcceptance firstName={firstName} source={source} next={next || null} />;
  }
  if (consent.status === 'unavailable') {
    console.error('[welcome] consent store unavailable:', consent.error);
  }

  // Already accepted and on their way somewhere: go there.
  if (next) redirect(next);

  // roles_v1: one Offer choice replaces "list my gear" and "offer my
  // services" (TASK-085); renting and booking stay as they are.
  const rolesOn = await getFlag('roles_v1');
  return <WelcomeChoices firstName={firstName} choices={rolesOn ? WELCOME_CHOICES_ROLES : WELCOME_CHOICES} />;
}
