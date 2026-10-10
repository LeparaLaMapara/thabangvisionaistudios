export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { OWNER_VISIBLE_STATUSES, ownerHireViews, type OwnerHireFacts, type OwnerPayoutFacts } from '@/lib/rental/owner-earnings';

/**
 * GET: hires of the caller's own community gear, with their share and payout
 * state (lib/rental/owner-earnings.ts). Owners cannot read renters' booking
 * rows under RLS, so the service role reads them here, filtered to gear the
 * caller owns, and returns dates, stages and amounts only: nothing about the
 * renter.
 */
export async function GET(): Promise<NextResponse> {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const db = createAdminClient();
  try {
    const { data: gear, error: gearErr } = await db.from('smart_rentals').select('id, title').eq('owner_id', auth.user.id);
    if (gearErr) throw new Error(gearErr.message);
    const titles = new Map(((gear ?? []) as { id: string; title: string | null }[]).map((g) => [g.id, g.title]));
    if (titles.size === 0) return NextResponse.json({ hires: [] });

    const { data: rows, error: rowsErr } = await db
      .from('equipment_bookings')
      .select('id, rental_id, start_date, end_date, status, owner_share_cents, completed_at')
      .in('rental_id', [...titles.keys()])
      .in('status', OWNER_VISIBLE_STATUSES)
      .order('start_date', { ascending: false })
      .limit(50);
    if (rowsErr) throw new Error(rowsErr.message);
    const hires = ((rows ?? []) as (Omit<OwnerHireFacts, 'rental_title'> & { rental_id: string })[]).map(({ rental_id, ...h }) => ({ ...h, rental_title: titles.get(rental_id) ?? null }));

    let payouts: OwnerPayoutFacts[] = [];
    if (hires.length > 0) {
      const { data: p, error: pErr } = await db
        .from('owner_payouts')
        .select('booking_id, state, owner_amount_cents, scheduled_at, completed_at')
        .eq('owner_id', auth.user.id)
        .in('booking_id', hires.map((h) => h.id));
      if (pErr) throw new Error(pErr.message);
      payouts = (p ?? []) as OwnerPayoutFacts[];
    }
    return NextResponse.json({ hires: ownerHireViews(hires, payouts) });
  } catch (err) {
    console.error('[listings/earnings] failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Could not load your hires just now.' }, { status: 500 });
  }
}
