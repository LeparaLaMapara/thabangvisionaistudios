export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isPayFastConfigured, buildPaymentData, getPayFastUrl } from '@/lib/payfast';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { plan_id } = body;

  if (!plan_id) {
    return NextResponse.json(
      { error: 'plan_id is required.' },
      { status: 400 },
    );
  }

  // Fetch the plan
  const { data: plan, error: planError } = await supabase
    .from('subscription_plans')
    .select('*')
    .eq('id', plan_id)
    .eq('is_active', true)
    .single();

  if (planError || !plan) {
    return NextResponse.json(
      { error: 'Subscription plan not found.' },
      { status: 404 },
    );
  }

  // Check for existing active subscription
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single();

  if (existing) {
    return NextResponse.json(
      { error: 'You already have an active subscription.' },
      { status: 409 },
    );
  }

  // Verify profile exists
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json(
      { error: 'Profile not found. Please complete your profile first.' },
      { status: 400 },
    );
  }

  const now = new Date();
  const periodEnd = new Date(now);
  if (plan.interval === 'year') {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }

  // Create subscription record (status: pending until payment confirms)
  const { data: sub, error: insertError } = await supabase
    .from('subscriptions')
    .insert({
      user_id: user.id,
      plan_id,
      status: 'active',
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Build PayFast payment URL if configured
  let paymentUrl: string | null = null;

  if (isPayFastConfigured() && plan.price > 0) {
    try {
      const paymentData = buildPaymentData({
        amount: plan.price,
        itemName: `${plan.name} Subscription (${plan.interval}ly)`,
        itemDescription: plan.description ?? `${plan.name} plan`,
        email: user.email ?? undefined,
        paymentId: sub.id,
        returnUrl: `/dashboard?subscription=success`,
        cancelUrl: `/pricing?subscription=cancelled`,
        customStr1: 'subscription',
        customStr2: user.id,
        customStr3: plan_id,
      });

      const params = new URLSearchParams(paymentData as Record<string, string>);
      paymentUrl = `${getPayFastUrl()}?${params.toString()}`;
    } catch (err) {
      console.error('[subscriptions] PayFast error:', err);
    }
  }

  return NextResponse.json(
    { ...sub, payment_url: paymentUrl },
    { status: 201 },
  );
}
