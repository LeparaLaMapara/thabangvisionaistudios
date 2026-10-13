export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { sms } from '@/lib/sms';
import { CODE_TTL_MINUTES, MAX_SENDS_PER_HOUR, PHONE_LIMITS, hashCode, maskPhone, newCode, normaliseSaMobile, phoneCodeSecret } from '@/lib/sms/phone';
import { checkRateLimit } from '@/lib/auth';
import { clientIp } from '@/lib/http/clientIp';
import { STUDIO } from '@/lib/constants';

/** Sends a one-time code to confirm the signed-in person's phone number. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in first.' }, { status: 401 });

  if (!sms.isConfigured()) {
    return NextResponse.json({ error: 'Phone checks are not switched on yet.' }, { status: 503 });
  }

  const { phone } = (await request.json().catch(() => ({}))) as { phone?: string };
  const e164 = normaliseSaMobile(phone ?? '');
  if (!e164) {
    return NextResponse.json({ error: 'Enter a South African mobile number, like 082 123 4567.' }, { status: 400 });
  }

  // Caps per network and per number as well as per account, so one person
  // with many accounts cannot SMS-bomb a number (each SMS costs money).
  const ip = clientIp(request.headers);
  if (
    !(await checkRateLimit(`phone-send-ip:${ip}`, PHONE_LIMITS.sendsPerIpPerHour, 3_600_000)) ||
    !(await checkRateLimit(`phone-send-number:${e164}`, PHONE_LIMITS.sendsPerNumberPerHour, 3_600_000))
  ) {
    return NextResponse.json({ error: 'Too many codes. Try again in an hour.' }, { status: 429 });
  }

  const secret = phoneCodeSecret();
  if (!secret) return NextResponse.json({ error: 'Phone checks are not switched on yet.' }, { status: 503 });

  const code = newCode();
  // One atomic step (088): saves the new code and counts the send, or refuses
  // when this account already had MAX_SENDS_PER_HOUR codes this hour.
  const { data: allowed, error } = await createAdminClient().rpc('phone_code_store', {
    p_user: user.id,
    p_phone: e164,
    p_code_hash: hashCode(code, user.id, secret),
    p_ttl_minutes: CODE_TTL_MINUTES,
    p_max_per_hour: MAX_SENDS_PER_HOUR,
  });
  if (error) return NextResponse.json({ error: 'Could not start the check. Try again.' }, { status: 500 });
  if (allowed !== true) {
    return NextResponse.json({ error: 'Too many codes. Try again in an hour.' }, { status: 429 });
  }

  const sent = await sms.send(e164, `${code} is your ${STUDIO.name} code. It expires in ${CODE_TTL_MINUTES} minutes. Never share it.`);
  if (!sent.ok) {
    console.error('[phone/send]', sent.error);
    return NextResponse.json({ error: 'The SMS could not be sent. Try again in a minute.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, sentTo: maskPhone(e164) });
}
