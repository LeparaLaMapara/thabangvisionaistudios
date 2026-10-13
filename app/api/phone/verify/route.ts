export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { MAX_ATTEMPTS, PHONE_LIMITS, codesMatch, hashCode, maskPhone, phoneCodeSecret } from '@/lib/sms/phone';
import { checkRateLimit } from '@/lib/auth';
import { clientIp } from '@/lib/http/clientIp';
import { logEvent } from '@/lib/data/events';

/** Checks the code and, if right, saves the number as verified on the profile. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in first.' }, { status: 401 });

  const { code } = (await request.json().catch(() => ({}))) as { code?: string };
  if (!code || !/^\d{6}$/.test(code.trim())) {
    return NextResponse.json({ error: 'Enter the 6-digit code.' }, { status: 400 });
  }

  const admin = createAdminClient();
  // Per-network cap across every account, on top of the per-code limit below.
  if (!(await checkRateLimit(`phone-verify-ip:${clientIp(request.headers)}`, PHONE_LIMITS.verifyPerIpPerHour, 3_600_000))) {
    return NextResponse.json({ error: 'Too many tries. Wait a while and try again.' }, { status: 429 });
  }
  // One atomic step (088): counts this try and returns the code only while it
  // is unexpired and under MAX_ATTEMPTS, so parallel guesses cannot all slip
  // in under the cap.
  const { data: rows, error: tryError } = await admin.rpc('phone_code_try', { p_user: user.id, p_max_attempts: MAX_ATTEMPTS });
  if (tryError) return NextResponse.json({ error: 'Could not check the code. Try again.' }, { status: 500 });
  const pending = (Array.isArray(rows) ? rows[0] : rows) as { phone: string; code_hash: string; outcome: string } | undefined;
  if (!pending || pending.outcome === 'expired') {
    return NextResponse.json({ error: 'That code has expired. Send a new one.' }, { status: 410 });
  }
  if (pending.outcome === 'too_many') {
    return NextResponse.json({ error: 'Too many tries. Send a new code.' }, { status: 429 });
  }

  const secret = phoneCodeSecret();
  if (!secret) return NextResponse.json({ error: 'Phone checks are not switched on yet.' }, { status: 503 });
  if (!codesMatch(hashCode(code.trim(), user.id, secret), pending.code_hash)) {
    return NextResponse.json({ error: 'That code is not right. Check the SMS and try again.' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error } = await admin.from('profiles').update({ phone: pending.phone, phone_verified_at: now }).eq('id', user.id);
  if (error) return NextResponse.json({ error: 'Could not save your number. Try again.' }, { status: 500 });
  await admin.from('phone_codes').delete().eq('user_id', user.id);

  logEvent({ eventType: 'phone_verified', eventCategory: 'verification', userId: user.id });
  return NextResponse.json({ ok: true, phone: maskPhone(pending.phone) });
}
