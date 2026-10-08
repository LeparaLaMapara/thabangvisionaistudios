import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/auth';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { payments } from '@/lib/payments';
import { fromCents } from '@/lib/core/pricing/money';
import {
  parseSubscriptionCheckoutBody,
  pricePlan,
  periodEnd,
  type PlanRow,
} from '@/lib/payments/subscriptions';
import { STUDIO } from '@/lib/constants';

export const dynamic = 'force-dynamic';

/**
 * POST /api/payfast/checkout — subscription checkout for the active payment
 * provider (the path name is historical; it goes through lib/payments).
 *
 * Accepts exactly: { plan_id: string, billing: 'monthly' | 'annual' }.
 * Any other field (amount, price, plan_name, discount, currency, ...) is a 400:
 * the price is resolved on the server from subscription_plans, never taken
 * from the browser.
 *
 * Initiation only: writes a PENDING subscription recording the expected
 * amount (cents), currency, interval and provider reference, then returns the
 * provider's payment URL. Activation happens in lib/payments/fulfil.ts once a
 * signed webhook matches that expectation.
 */
export async function POST(request: NextRequest) {
  // Subscriptions are switched off (STUDIO.subscriptions.enabled). While off,
  // nothing may create or change one.
  if (!STUDIO.subscriptions.enabled) {
    return NextResponse.json({ error: 'Subscriptions are not available.' }, { status: 404 });
  }

  // 1. Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: 'You must be signed in to subscribe.' },
      { status: 401 },
    );
  }

  if (!(await checkRateLimit(`payfast-checkout:${user.id}`, 3, 60_000))) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait before trying again.' },
      { status: 429 },
    );
  }

  // 2. Strict body: only plan_id and billing.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = parseSubscriptionCheckoutBody(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { plan_id, billing } = parsed.value;

  const admin = createAdminClient();

  try {
    // 3. Resolve the plan and its price on the server.
    const { data: planRow, error: planError } = await admin
      .from('subscription_plans')
      .select('id, name, price, currency, interval, is_active')
      .eq('id', plan_id)
      .maybeSingle();

    if (planError) {
      console.error('[checkout] Plan lookup error:', planError.message);
      return NextResponse.json({ error: 'Unknown plan.' }, { status: 400 });
    }

    const priced = pricePlan((planRow as PlanRow | null) ?? null, billing);
    if (!priced.ok) {
      return NextResponse.json({ error: priced.error }, { status: 400 });
    }
    const plan = priced.value;

    // Free plan — nothing to pay, just go to the dashboard.
    if (plan.amountCents === 0) {
      return NextResponse.json({ payment_url: '/dashboard?subscription=free' });
    }

    // 4. Check payment provider credentials
    if (!payments.isConfigured()) {
      return NextResponse.json(
        { error: 'Payment processing is not configured. Please contact support.' },
        { status: 503 },
      );
    }

    // 5. One active subscription per user. Existing subscribers keep the
    // price stored on their row; nothing here re-prices them.
    const { data: existing } = await admin
      .from('subscriptions')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: 'You already have an active subscription. Manage it from your dashboard.' },
        { status: 409 },
      );
    }

    // 6. Ensure profile exists
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json(
        { error: 'Please complete your profile before subscribing.' },
        { status: 400 },
      );
    }

    // 7. Pending subscription recording exactly what we expect to be paid.
    // Written with the service role (migration 059: users cannot write
    // subscriptions), always for the signed-in user.
    const now = new Date();
    const providerReference = `sub_${randomUUID()}`;
    const { data: sub, error: insertError } = await admin
      .from('subscriptions')
      .insert({
        user_id: user.id,
        plan_id: plan.id,
        status: 'pending',
        current_period_start: now.toISOString(),
        current_period_end: periodEnd(now, plan.interval).toISOString(),
        expected_amount_cents: plan.amountCents,
        currency: plan.currency,
        billing_interval: plan.interval,
        provider_reference: providerReference,
      })
      .select('id')
      .single();

    if (insertError || !sub) {
      console.error('[checkout] Insert subscription error:', insertError?.message);
      return NextResponse.json(
        { error: 'Failed to create subscription. Please try again.' },
        { status: 500 },
      );
    }

    // 8. Payment redirect. The provider reference is what the webhook echoes
    // back; fulfilment looks the pending row up by it.
    try {
      const checkout = await payments.createSubscriptionCheckout({
        subscriptionId: providerReference,
        amount: fromCents(plan.amountCents),
        planName: plan.name,
        email: user.email ?? undefined,
        returnUrl: '/dashboard?subscription=success',
        cancelUrl: '/pricing?subscription=cancelled',
        interval: plan.interval,
        metadata: {
          customStr1: 'subscription',
          customStr2: user.id,
          customStr3: plan.id,
          customStr4: plan.interval,
        },
      });

      return NextResponse.json({ payment_url: checkout.paymentUrl });
    } catch (err) {
      console.error('[checkout] Payment build error:', err);

      // Roll back the pending subscription (only while still pending).
      await admin.from('subscriptions').delete().eq('id', sub.id).eq('status', 'pending');

      return NextResponse.json(
        { error: 'Failed to create payment. Please try again.' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[checkout] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
