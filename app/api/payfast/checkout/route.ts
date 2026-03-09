import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  isPayFastConfigured,
  buildPaymentData,
  getPayFastUrl,
} from '@/lib/payfast';

export const dynamic = 'force-dynamic';

/**
 * POST /api/payfast/checkout
 *
 * Accepts: { plan_id: string, plan_name: string, amount: number, billing: 'monthly' | 'annual' }
 * Returns: { payment_url: string } or error
 *
 * Creates a pending subscription in Supabase, builds a signed PayFast
 * redirect URL, and returns it for the client to navigate to.
 */
export async function POST(request: NextRequest) {
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

  // 2. Parse body
  const body = await request.json();
  const { plan_id, plan_name, amount, billing } = body as {
    plan_id: string;
    plan_name: string;
    amount: number;
    billing: 'monthly' | 'annual';
  };

  if (!plan_id || !plan_name || amount == null || !billing) {
    return NextResponse.json(
      { error: 'Missing required fields: plan_id, plan_name, amount, billing.' },
      { status: 400 },
    );
  }

  // Free plan — just redirect to dashboard
  if (amount <= 0) {
    return NextResponse.json({ payment_url: '/dashboard?subscription=free' });
  }

  // 3. Check PayFast credentials
  if (!isPayFastConfigured()) {
    return NextResponse.json(
      { error: 'Payment processing is not configured. Please contact support.' },
      { status: 503 },
    );
  }

  // 4. Check for existing active subscription
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('id, plan_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: 'You already have an active subscription. Manage it from your dashboard.' },
      { status: 409 },
    );
  }

  // 5. Ensure profile exists
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

  // 6. Calculate period
  const now = new Date();
  const periodEnd = new Date(now);
  if (billing === 'annual') {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }

  // 7. Create pending subscription record
  const { data: sub, error: insertError } = await supabase
    .from('subscriptions')
    .insert({
      user_id: user.id,
      plan_id,
      status: 'pending',
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
    })
    .select('id')
    .single();

  if (insertError) {
    console.error('[payfast/checkout] Insert subscription error:', insertError.message);
    return NextResponse.json(
      { error: 'Failed to create subscription. Please try again.' },
      { status: 500 },
    );
  }

  // 8. Build signed PayFast redirect URL
  try {
    const interval = billing === 'annual' ? 'annual' : 'monthly';
    const paymentData = buildPaymentData({
      amount,
      itemName: `${plan_name} Plan (${interval})`,
      itemDescription: `${plan_name} subscription — billed ${interval}`,
      email: user.email ?? undefined,
      paymentId: sub.id,
      returnUrl: '/dashboard?subscription=success',
      cancelUrl: '/pricing?subscription=cancelled',
      customStr1: 'subscription',
      customStr2: user.id,
      customStr3: plan_id,
      customStr4: billing,
    });

    const params = new URLSearchParams(
      paymentData as Record<string, string>,
    );
    const paymentUrl = `${getPayFastUrl()}?${params.toString()}`;

    return NextResponse.json({ payment_url: paymentUrl });
  } catch (err) {
    console.error('[payfast/checkout] PayFast build error:', err);

    // Rollback the pending subscription
    await supabase.from('subscriptions').delete().eq('id', sub.id);

    return NextResponse.json(
      { error: 'Failed to create payment. Please try again.' },
      { status: 500 },
    );
  }
}
