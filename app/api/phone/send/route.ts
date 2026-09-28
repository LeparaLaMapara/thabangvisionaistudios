export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { sms } from '@/lib/sms';
import { CODE_TTL_MINUTES, MAX_SENDS_PER_HOUR, hashCode, maskPhone, newCode, normaliseSaMobile } from '@/lib/sms/phone';
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

  const admin = createAdminClient();
  const { data: existing } = await admin.from('phone_codes').select('created_at, sent_count').eq('user_id', user.id).maybeSingle();
  const withinHour = existing && Date.now() - new Date(existing.created_at).getTime() < 3_600_000;
  if (withinHour && existing.sent_count >= MAX_SENDS_PER_HOUR) {
    return NextResponse.json({ error: 'Too many codes. Try again in an hour.' }, { status: 429 });
  }

  const code = newCode();
  const secret = process.env.PHONE_CODE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const { error } = await admin.from('phone_codes').upsert({
    user_id: user.id,
    phone: e164,
    code_hash: hashCode(code, user.id, secret),
    expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString(),
    attempts: 0,
    sent_count: withinHour ? existing.sent_count + 1 : 1,
    created_at: withinHour ? existing.created_at : new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: 'Could not start the check. Try again.' }, { status: 500 });

  const sent = await sms.send(e164, `${code} is your ${STUDIO.name} code. It expires in ${CODE_TTL_MINUTES} minutes. Never share it.`);
  if (!sent.ok) {
    console.error('[phone/send]', sent.error);
    return NextResponse.json({ error: 'The SMS could not be sent. Try again in a minute.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, sentTo: maskPhone(e164) });
}
