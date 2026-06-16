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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'NOT SET';

  console.log('[popia-consent] user:', user.id, 'email:', user.email, 'supabase:', supabaseUrl);

  // Step 1: Check if profile exists
  const { data: existing, error: readError } = await admin
    .from('profiles')
    .select('id, popia_consent_at')
    .eq('id', user.id)
    .maybeSingle();

  console.log('[popia-consent] profile exists:', !!existing, 'readError:', readError?.message ?? 'none');

  if (!existing) {
    // Create profile first
    const { error: createError } = await admin
      .from('profiles')
      .insert({ id: user.id });

    if (createError) {
      console.error('[popia-consent] profile create failed:', createError.message, createError.code, createError.details);
      return NextResponse.json({ error: 'Failed to create profile.' }, { status: 500 });
    }
    console.log('[popia-consent] profile created for:', user.id);
  }

  // Step 2: Update consent fields (no inet column — just the essentials)
  const { error: updateError } = await admin
    .from('profiles')
    .update({
      popia_consent_at: now,
      popia_consent_version: STUDIO.legal.popia.version,
      marketing_opt_in: body.marketingOptIn === true,
    })
    .eq('id', user.id);

  if (updateError) {
    console.error('[popia-consent] update failed:', updateError.message, updateError.code, updateError.details);
    return NextResponse.json({ error: 'Failed to record consent.' }, { status: 500 });
  }

  // Step 3: Verify
  const { data: verify } = await admin
    .from('profiles')
    .select('popia_consent_at')
    .eq('id', user.id)
    .maybeSingle();

  console.log('[popia-consent] verify result:', verify?.popia_consent_at ?? 'NULL');

  if (!verify?.popia_consent_at) {
    console.error('[popia-consent] write did not persist after update for user:', user.id);
    return NextResponse.json({ error: 'Failed to record consent — please try again.' }, { status: 500 });
  }

  return NextResponse.json({ success: true, version: STUDIO.legal.popia.version });
}
