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

  try {
    // Admin client bypasses RLS — required because the user-session client's
    // UPDATE policy silently drops writes it deems unsafe.
    const admin = createAdminClient();

    const { data: existing } = await admin
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (!existing) {
      const { error: createError } = await admin
        .from('profiles')
        .insert({ id: user.id });

      if (createError) {
        console.error('[popia-consent] profile create failed:', createError.message);
        return NextResponse.json({ error: 'Failed to create profile.' }, { status: 500 });
      }
    }

    const { error: updateError } = await admin
      .from('profiles')
      .update({
        popia_consent_at: new Date().toISOString(),
        popia_consent_version: STUDIO.legal.popia.version,
        marketing_opt_in: body.marketingOptIn === true,
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('[popia-consent] update failed:', updateError.message);
      return NextResponse.json({ error: 'Failed to record consent.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, version: STUDIO.legal.popia.version });
  } catch (err) {
    console.error('[popia-consent] unexpected error:', err);
    return NextResponse.json({ error: 'Failed to record consent.' }, { status: 500 });
  }
}
