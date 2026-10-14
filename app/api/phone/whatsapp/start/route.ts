export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { CODE_TTL_MINUTES, MAX_SENDS_PER_HOUR, PHONE_LIMITS, maskPhone, newCode, normaliseSaMobile, phoneCodeSecret } from '@/lib/sms/phone';
import {
  currentPhoneVerifyChannel,
  formatWhatsappCode,
  whatsappBusinessDigits,
  whatsappCodeHash,
  whatsappVerifyLink,
} from '@/lib/phone-verify';
import { checkRateLimit } from '@/lib/auth';
import { clientIp } from '@/lib/http/clientIp';

/**
 * Starts a WhatsApp phone check: saves a one-time code for the signed-in
 * person and the number they typed, and returns the wa.me link that sends it.
 * Nothing is sent from here; the person messages us (free inbound), and
 * /api/webhooks/whatsapp confirms the number that sent it.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Please sign in first.' }, { status: 401 });

    const business = whatsappBusinessDigits();
    const secret = phoneCodeSecret();
    if (currentPhoneVerifyChannel() !== 'whatsapp' || !business || !secret) {
      return NextResponse.json({ error: 'Phone checks are not switched on yet.' }, { status: 503 });
    }

    const { phone } = (await request.json().catch(() => ({}))) as { phone?: string };
    const e164 = normaliseSaMobile(phone ?? '');
    if (!e164) {
      return NextResponse.json({ error: 'Enter a South African mobile number, like 082 123 4567.' }, { status: 400 });
    }

    const ip = clientIp(request.headers);
    if (
      !(await checkRateLimit(`phone-send-ip:${ip}`, PHONE_LIMITS.sendsPerIpPerHour, 3_600_000)) ||
      !(await checkRateLimit(`phone-send-number:${e164}`, PHONE_LIMITS.sendsPerNumberPerHour, 3_600_000))
    ) {
      return NextResponse.json({ error: 'Too many codes. Try again in an hour.' }, { status: 429 });
    }

    const digits = newCode();
    const { data: allowed, error } = await createAdminClient().rpc('phone_code_store', {
      p_user: user.id,
      p_phone: e164,
      p_code_hash: whatsappCodeHash(digits, user.id, secret),
      p_ttl_minutes: CODE_TTL_MINUTES,
      p_max_per_hour: MAX_SENDS_PER_HOUR,
    });
    if (error) return NextResponse.json({ error: 'Could not start the check. Try again.' }, { status: 500 });
    if (allowed !== true) {
      return NextResponse.json({ error: 'Too many codes. Try again in an hour.' }, { status: 429 });
    }

    const code = formatWhatsappCode(digits);
    const { text, link } = whatsappVerifyLink(business, code);
    return NextResponse.json({
      ok: true,
      channel: 'whatsapp',
      code,
      text,
      link,
      sendFrom: maskPhone(e164),
      expiresInMinutes: CODE_TTL_MINUTES,
    });
  } catch {
    return NextResponse.json({ error: 'Could not start the check. Try again.' }, { status: 500 });
  }
}
