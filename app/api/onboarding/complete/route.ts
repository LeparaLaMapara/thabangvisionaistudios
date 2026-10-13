export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { createCreatorProduction } from '@/lib/supabase/queries/smartProductions';
import { onboardingNextPath } from '@/lib/onboarding/progress';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Optional body: { draftedGear } from the gear step. An empty body is fine.
    const body = (await request.json().catch(() => ({}))) as { draftedGear?: unknown };

    const admin = createAdminClient();

    // The production row first. The profile used to be marked onboarded
    // before this ran, so when it failed the creator was recorded as
    // onboarded, stuck on the last step, and never sent to the ID check.
    const result = await createCreatorProduction(user.id);

    if (!result.success) {
      console.error('[onboarding/complete] production creation failed:', result.error);
      return NextResponse.json(
        { error: 'We could not save your creator profile just now. Please try again in a minute.' },
        { status: 500 },
      );
    }

    // available_for_hire is NOT switched on here. Finishing onboarding is not
    // a check: a creator becomes bookable once their ID is verified (the
    // admin approval turns it on, migration 033) and they keep it on from
    // the profile page, which also requires a payout account and a complete
    // portfolio. Booking routes re-check verified, available and not
    // suspended (lib/bookings/creator.ts).
    const now = new Date().toISOString();
    const { data: profile, error: profileErr } = await admin
      .from('profiles')
      .update({
        onboarding_completed_at: now,
        updated_at: now,
      })
      .eq('id', user.id)
      .select('verification_status')
      .maybeSingle();

    if (profileErr) {
      console.error('[onboarding/complete] profile update failed:', profileErr.message);
      return NextResponse.json({ error: 'Failed to update profile.' }, { status: 500 });
    }

    const draftedGear = Number(body.draftedGear ?? 0);
    const next = onboardingNextPath({
      verificationStatus: (profile?.verification_status as string | null | undefined) ?? null,
      draftedGear: Number.isFinite(draftedGear) ? draftedGear : 0,
    });

    return NextResponse.json({ success: true, next });
  } catch (err) {
    console.error('[onboarding/complete] unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
