export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/auth';
import { STUDIO } from '@/lib/constants';
import { sms } from '@/lib/sms';
import { getCartItems } from '@/lib/supabase/queries/cart';
import { rentalReadiness, trustLineForRental, trustLinesFromCart } from '@/lib/rental/eligibility-server';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/rentals/eligibility — what the signed-in renter still needs before
 * an order can be paid for (spec §9: show requirements before payment).
 *
 *   ?rental_id=&quantity=&start=&end=   one listing (the gear page)
 *   (no rental_id)                      the renter's cart, with its dates
 *                                       (&start=&end= for lines without dates)
 *   &delivery=1                         check delivery as well as collection
 *
 * Read-only and advisory: POST /api/cart/checkout re-checks everything. Only
 * the renter's own facts are used, and only codes, labels and links leave.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Sign in to see what you need to rent.', code: 'SIGN_IN_REQUIRED' },
      { status: 401 },
    );
  }

  if (!(await checkRateLimit(`eligibility:${user.id}`, 30, 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 });
  }

  const params = request.nextUrl.searchParams;
  const rentalId = params.get('rental_id');
  const start = params.get('start') ?? params.get('start_date');
  const end = params.get('end') ?? params.get('end_date');
  const delivery = params.get('delivery') === '1' || params.get('delivery') === 'true';
  const quantityRaw = Number(params.get('quantity') ?? '1');
  const quantity = Number.isFinite(quantityRaw) ? Math.max(1, Math.min(STUDIO.rental.maxQuantityPerItem, Math.floor(quantityRaw))) : 1;

  if (rentalId !== null && !UUID.test(rentalId)) {
    return NextResponse.json({ error: 'Unknown listing.' }, { status: 400 });
  }
  if ((start && !YMD.test(start)) || (end && !YMD.test(end)) || (start && !end) || (!start && end)) {
    return NextResponse.json({ error: 'Dates must be given together as YYYY-MM-DD.' }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    let lines;
    if (rentalId) {
      const line = await trustLineForRental(admin, rentalId, quantity, start ?? undefined, end ?? undefined);
      if (!line) return NextResponse.json({ error: 'Listing not found.' }, { status: 404 });
      lines = [line];
    } else {
      // Undated cart lines take the dates asked about, as the checkout gives
      // them the dates it is sent, so this answers what the checkout would.
      lines = trustLinesFromCart(await getCartItems(user.id), start && end ? { startDate: start, endDate: end } : undefined);
    }
    const readiness = await rentalReadiness(admin, user, lines, delivery, sms.isConfigured());
    return NextResponse.json(readiness, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[rentals/eligibility]', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ error: 'Could not check this just now.' }, { status: 503 });
  }
}
