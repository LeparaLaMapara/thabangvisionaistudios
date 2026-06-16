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
