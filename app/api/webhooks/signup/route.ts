export const dynamic = 'force-dynamic';

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse, after } from 'next/server';
import { processSignup } from '@/lib/greetings/process';
import { sendWelcomeSoon } from '@/lib/engagement/runner';

/**
 * Called by the database when an account is created (migration 060,
 * notify_signup). Drafts Ubunye's welcome, emails the owner and, when the
 * person's email is already confirmed (Google), sends the welcome.
 *
 * Answers at once (202) and does the work after the response: pg_net gives
 * up after 5 seconds, and drafting with AI plus two emails takes longer, so
 * every call was logged as timed out (2026-10-03) although the work finished.
 */
function secretMatches(given: string | null): boolean {
  const expected = process.env.SIGNUP_WEBHOOK_SECRET;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!secretMatches(request.headers.get('x-signup-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let userId: unknown;
  try {
    ({ user_id: userId } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 });
  }

  const id = userId;
  after(async () => {
    try {
      const result = await processSignup(id);
      if (result.status === 'drafted' || result.status === 'exists') await sendWelcomeSoon(id);
    } catch (err) {
      console.error('[webhooks/signup]', err);
    }
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
