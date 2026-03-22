import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Check if onboarding is completed — if not, send to onboarding
        const { data: profile } = await supabase
          .from('profiles')
          .select('onboarding_completed_at')
          .eq('id', user.id)
          .single();

        if (!profile || !profile.onboarding_completed_at) {
          return NextResponse.redirect(new URL('/onboarding', origin));
        }

        // Admin users go to admin dashboard (role set in app_metadata)
        if (user.app_metadata?.role === 'admin') {
          return NextResponse.redirect(new URL('/admin', origin));
        }
      }

      return NextResponse.redirect(new URL('/dashboard', origin));
    }
  }

  // Auth code exchange failed — redirect to login with error
  return NextResponse.redirect(new URL('/login?error=auth', origin));
}
