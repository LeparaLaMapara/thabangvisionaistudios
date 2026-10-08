export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/auth';
import { clientIp } from '@/lib/http/clientIp';
import {
  checkConsents,
  recordConsent,
  requiredConsents,
  validateConsentRequest,
  type ConsentContext,
} from '@/lib/consent';

const CONTEXTS: readonly ConsentContext[] = ['onboarding', 'checkout', 'verification', 'listing'];

// ─── GET — which consents the signed-in person still needs for a context ─────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const context = req.nextUrl.searchParams.get('context');
  if (!context || !(CONTEXTS as readonly string[]).includes(context)) {
    return NextResponse.json({ error: 'Unknown context.' }, { status: 400 });
  }

  const check = await checkConsents(supabase, user.id, requiredConsents(context as ConsentContext));
  if (check.status === 'unavailable') {
    console.error('[consent GET] store unavailable:', check.error);
    return NextResponse.json({ error: 'Consent records are unavailable.' }, { status: 503 });
  }
  return NextResponse.json(
    { missing: check.status === 'missing' ? check.missing : [] },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// ─── POST — record acceptance of the currently published documents ──────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await checkRateLimit(`consent:${user.id}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = validateConsentRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await recordConsent(supabase, {
      userId: user.id,
      purposes: parsed.value.purposes,
      source: parsed.value.source,
      ip: clientIp(req.headers),
      userAgent: req.headers.get('user-agent'),
    });

    if (!result.ok) {
      console.error('[consent POST] insert failed:', result.error);
      return NextResponse.json(
        { error: 'Failed to record your acceptance. Please try again.' },
        { status: result.missingTable ? 503 : 500 },
      );
    }

    return NextResponse.json({ success: true, recorded: result.recorded }, { status: 201 });
  } catch (err) {
    console.error('[consent POST] unexpected error:', err);
    return NextResponse.json({ error: 'Failed to record your acceptance.' }, { status: 500 });
  }
}
