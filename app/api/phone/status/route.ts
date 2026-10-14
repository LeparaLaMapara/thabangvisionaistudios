export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { PHONE_LIMITS } from '@/lib/sms/phone';
import { currentPhoneVerifyChannel } from '@/lib/phone-verify';
import { checkRateLimit } from '@/lib/auth';

/**
 * Whether phone confirmation is switched on and by which channel, so the
 * profile page can hide the step until it is. For a signed-in person it also
 * says whether their number is confirmed (the page polls this while a
 * WhatsApp check is open), returning their own number only once confirmed.
 */
export async function GET() {
  const channel = currentPhoneVerifyChannel();
  const base = { available: channel !== 'off', channel };
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json(base, { headers });

    if (!(await checkRateLimit(`phone-status:${user.id}`, PHONE_LIMITS.statusPerUserPerHour, 3_600_000))) {
      return NextResponse.json({ error: 'Too many checks. Wait a while and try again.' }, { status: 429 });
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('phone, phone_verified_at')
      .eq('id', user.id)
      .maybeSingle();
    if (error) return NextResponse.json(base, { headers });

    const row = data as { phone: string | null; phone_verified_at: string | null } | null;
    const verified = Boolean(row?.phone && row.phone_verified_at);
    return NextResponse.json({ ...base, verified, phone: verified ? row?.phone : null }, { headers });
  } catch {
    return NextResponse.json(base, { headers });
  }
}
