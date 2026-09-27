import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/auth/redirect';

/**
 * Where Google and email sign-in links land.
 *
 * Until 2026-09-27 no Google sign-in ever finished: Supabase sent people to an
 * old test site because www.thabangvision.com was missing from its allowed
 * return addresses, and this route failed silently. It now logs why a sign-in
 * failed and returns people to the page they were on (`?next=`).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeNextPath(searchParams.get('next'), '');

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        if (user.app_metadata?.role === 'admin') {
          return NextResponse.redirect(new URL('/admin', origin));
        }

        // They were on their way somewhere (a gear page, a booking): go there.
        if (next) return NextResponse.redirect(new URL(next, origin));

        const { data: profile } = await supabase
          .from('profiles')
          .select('onboarding_completed_at')
          .eq('id', user.id)
          .single();

        if (!profile || !profile.onboarding_completed_at) {
          return NextResponse.redirect(new URL('/onboarding', origin));
        }
      }

      return NextResponse.redirect(new URL('/dashboard', origin));
    }

    console.error('[auth/callback] code exchange failed:', error.message);
  } else {
    const reason = searchParams.get('error_description') ?? searchParams.get('error');
    console.error('[auth/callback] no code in the return:', reason ?? 'no reason given');
  }

  // Back to the login page with a plain message, keeping where they were going.
  const back = new URL('/login', origin);
  back.searchParams.set('error', 'auth');
  if (next) back.searchParams.set('redirect', next);
  return NextResponse.redirect(back);
}
