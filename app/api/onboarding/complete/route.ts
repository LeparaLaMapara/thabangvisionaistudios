export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { createCreatorProduction } from '@/lib/supabase/queries/smartProductions';

export async function POST(): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const now = new Date().toISOString();

    // available_for_hire is NOT switched on here. Finishing onboarding is not
    // a check: a creator becomes bookable once their ID is verified (the
    // admin approval turns it on, migration 033) and they keep it on from
    // the profile page, which also requires a payout account and a complete
    // portfolio. Booking routes re-check verified, available and not
    // suspended (lib/bookings/creator.ts).
    const { error: profileErr } = await admin
      .from('profiles')
      .update({
        onboarding_completed_at: now,
        updated_at: now,
      })
      .eq('id', user.id);

    if (profileErr) {
      console.error('[onboarding/complete] profile update failed:', profileErr.message);
      return NextResponse.json({ error: 'Failed to update profile.' }, { status: 500 });
    }

    const result = await createCreatorProduction(user.id);

    if (!result.success) {
      console.error('[onboarding/complete] production creation failed:', result.error);
      return NextResponse.json({ error: 'Failed to create production listing.' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[onboarding/complete] unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
