export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { MAX_ATTEMPTS, codesMatch, hashCode, maskPhone } from '@/lib/sms/phone';
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
  const { data: pending } = await admin.from('phone_codes').select('*').eq('user_id', user.id).maybeSingle();
  if (!pending || new Date(pending.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'That code has expired. Send a new one.' }, { status: 410 });
  }
  if (pending.attempts >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: 'Too many tries. Send a new code.' }, { status: 429 });
  }

  const secret = process.env.PHONE_CODE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!codesMatch(hashCode(code.trim(), user.id, secret), pending.code_hash)) {
    await admin.from('phone_codes').update({ attempts: pending.attempts + 1 }).eq('user_id', user.id);
    return NextResponse.json({ error: 'That code is not right. Check the SMS and try again.' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error } = await admin.from('profiles').update({ phone: pending.phone, phone_verified_at: now }).eq('id', user.id);
  if (error) return NextResponse.json({ error: 'Could not save your number. Try again.' }, { status: 500 });
  await admin.from('phone_codes').delete().eq('user_id', user.id);

  logEvent({ eventType: 'phone_verified', eventCategory: 'verification', userId: user.id });
  return NextResponse.json({ ok: true, phone: maskPhone(pending.phone) });
}
