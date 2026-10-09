export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/auth';
import { DELIVERY_CHECKOUT, STUDIO } from '@/lib/constants';
import { getCartItems } from '@/lib/supabase/queries/cart';
import { evaluateDeliveryEligibility } from '@/lib/core/delivery/policy';
import { deliveryDeps } from '@/lib/delivery/server';
import { cartLinesForDelivery, deliveryLines } from '@/lib/delivery/checkout';

/**
 * Whether the signed-in renter may have the gear in their cart delivered
 * (spec §4.17: show delivery only to eligible customers). The same rules as
 * the quote and the checkout (first hire, items over the high-value limit,
 * trust tier, account holds); the address is checked when they ask for a
 * quote. Read-only; prices never come from here.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await checkRateLimit(`delivery-eligibility:${user.id}`, 30, 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 });
  }

  const base = {
    service_area: STUDIO.serviceArea.summary,
    windows: DELIVERY_CHECKOUT.windows,
    // Only our own vehicle today: no courier is offered until the founder
    // approves it and transit cover is verified (D-37, D-41).
    courier_available: false,
  };

  try {
    const items = await getCartItems(user.id);
    if (items.length === 0) return NextResponse.json({ ...base, delivery_available: false, code: 'empty_cart', message: 'Your cart is empty.' });
    const cart = cartLinesForDelivery(items);
    if (!cart) return NextResponse.json({ ...base, delivery_available: false, code: 'dates_required', message: 'Choose dates for each item to see delivery options.' });

    const deps = await deliveryDeps();
    const { facts, holdings } = await deps.trust.getTrustInputs(user.id);
    const elig = evaluateDeliveryEligibility({
      facts,
      currentExposureCents: 0,
      holdings,
      lines: deliveryLines(cart),
      // The address itself is verified on the server when they ask for a quote.
      destination: { province: STUDIO.serviceArea.province },
      courierFlagEnabled: deps.flags.courierEnabled,
      ownFleetEnabled: deps.flags.ownFleetEnabled,
      now: deps.clock.now(),
      policy: deps.policy,
    });
    if (!elig.ok) return NextResponse.json({ ...base, delivery_available: false, code: elig.code, message: elig.message });
    return NextResponse.json({ ...base, delivery_available: true, courier_available: elig.modes.includes('courier'), own_vehicle: elig.modes.includes('own_fleet') });
  } catch (err) {
    console.error('[delivery/eligibility] failed:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ ...base, delivery_available: false, code: 'check_unavailable', message: 'We could not check delivery just now. You can collect in person, or try again.' }, { status: 503 });
  }
}
