export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
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

  return <WelcomeChoices firstName={firstName} />;
}
