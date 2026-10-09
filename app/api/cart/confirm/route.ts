export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/auth';
import { isMissingPipeline } from '@/lib/rental/repos';
import { confirmPaymentOnReturn } from '@/lib/rental/workers';
import { dispatchOutbox } from '@/lib/rental/notify';
import { logEvent } from '@/lib/data/events';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/cart/confirm { checkout_group_id }
 *
 * Called once by the page the payment provider sends a customer back to
 * (?payment=success). The browser's word proves nothing, so this asks the
 * provider, server to server, whether the order's charge went through, and
 * confirms it through the same use case as the webhook (a webhook arriving
 * later is a duplicate). Without this, a lost or slow webhook left a paid
 * order "being confirmed" until the daily recovery pass, and its dates
 * unprotected once the hold ran out.
 *
 * Answers only for the signed-in customer's own order, and never releases
 * or cancels anything.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await checkRateLimit(`cart-confirm:${user.id}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Please wait.' }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { checkout_group_id?: unknown };
  const groupId = typeof body.checkout_group_id === 'string' ? body.checkout_group_id : '';
  if (!UUID.test(groupId)) return NextResponse.json({ error: 'Unknown order.' }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('rental_payment_intents')
    .select('reference, provider, state, user_id')
    .eq('checkout_group_id', groupId)
    .maybeSingle();
  if (error) {
    // Before migration 070 there are no intents: the webhook is the only path.
    if (isMissingPipeline(error)) return NextResponse.json({ state: 'unknown' });
    console.error('[cart/confirm] could not load the payment intent:', error.message);
    return NextResponse.json({ error: 'Could not check your payment just now.' }, { status: 503 });
  }
  const intent = data as { reference: string; provider: string; state: string; user_id: string } | null;
  // Someone else's order looks exactly like no order.
  if (!intent || intent.user_id !== user.id) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });

  try {
    const result = await confirmPaymentOnReturn(admin, intent);
    if (result.state === 'paid') {
      logEvent({ eventType: 'payment_confirmed_on_return', eventCategory: 'payment', userId: user.id, metadata: { checkoutGroupId: groupId, outcome: result.outcome } });
      // Send what the confirmation queued now; failures stay in the outbox.
      try {
        await dispatchOutbox(20);
      } catch {
        /* the pipeline job sends them */
      }
    }
    return NextResponse.json({ state: result.state, ...(result.state === 'paid' ? { outcome: result.outcome } : {}) });
  } catch (err) {
    console.error('[cart/confirm] check failed:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ state: 'unknown' }, { status: 503 });
  }
}
