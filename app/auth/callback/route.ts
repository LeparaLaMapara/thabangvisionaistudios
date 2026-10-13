import { NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkConsents, requiredConsents } from '@/lib/consent';
import { afterSignInPath, cleanNextPath, type ConsentState } from '@/lib/auth/next-path';
import { homeFor } from '@/lib/welcome';
import { sendWelcomeSoon } from '@/lib/engagement/runner';

/**
 * Where Google and email sign-in links land.
 *
 * Until 2026-09-27 no Google sign-in ever finished: Supabase sent people to an
 * old test site because www.thabangvision.com was missing from its allowed
 * return addresses, and this route failed silently. It now logs why a sign-in
 * failed and returns people to the page they were on (`?next=`).
 *
 * Anyone without a current acceptance of the Terms and Privacy Policy on
 * record goes to /welcome first (one tap records it), then on to `next`.
 * Before this, Google and email-link sign-ins with a `?next=` skipped
 * /welcome and were never asked.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = cleanNextPath(searchParams.get('next'));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const isAdmin = user.app_metadata?.role === 'admin';
        if (isAdmin) {
          return NextResponse.redirect(new URL(afterSignInPath({ isAdmin, consent: 'ok', next }), origin));
        }

        // A just-confirmed email: their welcome can go now (no-op once sent).
        const welcomeId = user.id;
        after(() => sendWelcomeSoon(welcomeId));

        const check = await checkConsents(supabase, user.id, requiredConsents('onboarding'));
        const consent: ConsentState =
          check.status === 'ok' ? 'ok' : check.status === 'missing' ? 'missing' : 'unknown';
        if (check.status === 'unavailable') {
          // Let them through (as /welcome does); checkout checks again.
          console.error('[auth/callback] consent store unavailable:', check.error);
        }

        // They were on their way somewhere (a gear page, a booking): go
        // there. Otherwise: what they said they came to do. Someone who has
        // not said yet is asked once (/welcome) instead of being put through
        // creator onboarding.
        let fallback = next;
        if (!fallback) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('onboarding_completed_at')
            .eq('id', user.id)
            .single();
          fallback = homeFor(user.user_metadata?.intent, !!profile?.onboarding_completed_at);
        }

        const destination = afterSignInPath({ isAdmin, consent, next, fallback });
        return NextResponse.redirect(new URL(destination, origin));
      }

      return NextResponse.redirect(new URL('/dashboard', origin));
    }

    console.error('[auth/callback] code exchange failed:', error.message);
  } else {
    const reason = searchParams.get('error_description') ?? searchParams.get('error');
    console.error('[auth/callback] no code in the return:', reason ?? 'no reason given');
  }

  // Back to the sign-in page with a plain message, keeping where they were going.
  const back = new URL('/login', origin);
  back.searchParams.set('error', 'auth');
  if (next) back.searchParams.set('next', next);
  return NextResponse.redirect(back);
}
