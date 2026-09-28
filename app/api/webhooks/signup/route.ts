export const dynamic = 'force-dynamic';

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { processSignup } from '@/lib/greetings/process';

/**
 * Called by the database when an account is created (migration 060,
 * notify_signup). Drafts Ubunye's welcome and emails the owner.
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

  try {
    const result = await processSignup(userId);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[webhooks/signup]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
