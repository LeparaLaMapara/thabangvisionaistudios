export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { STUDIO } from '@/lib/constants';

// ─── GET — Return current user's consent status ─────────────────────────────

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('popia_consent_at, popia_consent_version, marketing_opt_in')
    .eq('id', user.id)
    .single();

  return NextResponse.json({
    consented: !!profile?.popia_consent_at,
    consentedAt: profile?.popia_consent_at ?? null,
    version: profile?.popia_consent_version ?? null,
    currentVersion: STUDIO.legal.popia.version,
    marketingOptIn: profile?.marketing_opt_in ?? false,
  });
}

// ─── POST — Record POPIA consent ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { accepted?: boolean; isAdult?: boolean; marketingOptIn?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (body.accepted !== true || body.isAdult !== true) {
    return NextResponse.json(
      { error: 'You must accept the privacy notice and confirm you are 18 or older.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const consentData: Record<string, unknown> = {
    popia_consent_at: now,
    popia_consent_version: STUDIO.legal.popia.version,
    marketing_opt_in: body.marketingOptIn === true,
  };

  // Store IP for audit trail — skip if format is invalid for inet column
  const rawIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? null;
  if (rawIp && /^[\d.:a-fA-F]+$/.test(rawIp)) {
    consentData.popia_consent_ip = rawIp;
  }

  // Update the profile row
  const { error: updateError } = await admin
    .from('profiles')
    .update(consentData)
    .eq('id', user.id);

  if (updateError) {
    console.error('[popia-consent] update failed:', updateError.message);
    return NextResponse.json({ error: 'Failed to record consent.' }, { status: 500 });
  }

  // Verify the write actually landed (update silently affects 0 rows if profile doesn't exist)
  const { data: verify } = await admin
    .from('profiles')
    .select('popia_consent_at')
    .eq('id', user.id)
    .maybeSingle();

  if (!verify?.popia_consent_at) {
    // Profile row likely doesn't exist — create it
    const { error: insertError } = await admin
      .from('profiles')
      .insert({ id: user.id, ...consentData });

    if (insertError) {
      console.error('[popia-consent] insert fallback failed:', insertError.message);
      return NextResponse.json({ error: 'Failed to record consent.' }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true, version: STUDIO.legal.popia.version });
}
