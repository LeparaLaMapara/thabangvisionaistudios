import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Marks a newsletter subscriber as unsubscribed.
 *
 * Deliberately does not require a login: the whole point is that someone who
 * never made an account can still get themselves off the list. POPIA section 69
 * gives a data subject the right to withdraw consent to direct marketing, and a
 * right you can only exercise by emailing support is not much of a right.
 *
 * Always answers the same way whether or not the address is on the list, so the
 * endpoint cannot be used to test whether someone is subscribed.
 */
async function unsubscribe(rawEmail: unknown, ip: string) {
  if (!(await checkRateLimit(`newsletter-unsub:${ip}`, 5, 60_000))) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait before trying again.' },
      { status: 429 },
    );
  }

  if (!rawEmail || typeof rawEmail !== 'string') {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  }

  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 });
  }

  // Service role: the table is service-role only (RLS "for all using (false)"),
  // and an unauthenticated person must still be able to remove themselves.
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from('newsletter_subscribers')
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq('email', email)
      .is('unsubscribed_at', null);

    if (error) {
      console.error('[newsletter/unsubscribe] DB error:', error.message);
      return NextResponse.json(
        { error: 'We could not complete that just now. Please email us and we will remove you.' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[newsletter/unsubscribe] threw:', err);
    return NextResponse.json(
      { error: 'We could not complete that just now. Please email us and we will remove you.' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    message: 'You have been unsubscribed. You will not receive further marketing emails from us.',
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  try {
    const { email } = await req.json();
    return await unsubscribe(email, ip);
  } catch {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}

/**
 * One-click form of the same thing, so an unsubscribe link in an email works
 * without the recipient having to type anything.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  return unsubscribe(req.nextUrl.searchParams.get('email'), ip);
}
