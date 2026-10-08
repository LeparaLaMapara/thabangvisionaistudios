export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { checkConsents, requiredConsents } from '@/lib/consent';
import { OnboardingAcceptance } from '@/components/consent/OnboardingAcceptance';
import WelcomeChoices from './WelcomeChoices';

export const metadata = {
  title: 'Welcome',
};

/**
 * The first screen after signing up: one question, "What did you come to do?".
 *
 * Every new account used to land on a creator onboarding ("Join the Network,
 * upload 2 portfolio photos") or a dashboard that said "Welcome back", even
 * for someone who only wanted to rent a camera for the weekend. None of the
 * first 32 real signups got further. This asks once and sends each person to
 * the thing they came for.
 */
export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login?redirect=%2Fwelcome');

  const meta = (user.user_metadata ?? {}) as { full_name?: string; name?: string };
  const firstName = (meta.full_name || meta.name || '').split(' ')[0] || null;

  // Accept the current Terms and Privacy Policy once (Google sign-ups never
  // saw the register form's checkbox). If the consent store cannot be read
  // (e.g. migration 068 not applied yet), let the person through rather than
  // trap them on a screen whose save would fail; checkout checks again.
  const consent = await checkConsents(supabase, user.id, requiredConsents('onboarding'));
  if (consent.status === 'missing') {
    const source = user.app_metadata?.provider === 'email' ? 'signup' : 'oauth_onboarding';
    return <OnboardingAcceptance firstName={firstName} source={source} />;
  }
  if (consent.status === 'unavailable') {
    console.error('[welcome] consent store unavailable:', consent.error);
  }

  return <WelcomeChoices firstName={firstName} />;
}
