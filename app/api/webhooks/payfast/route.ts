import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  isPayFastConfigured,
  isPayFastIP,
  validateSignature,
  validateITN,
  type PayFastPaymentStatus,
} from '@/lib/payfast';

export const dynamic = 'force-dynamic';

// ─── ITN handlers ───────────────────────────────────────────────────────────

async function handlePaymentComplete(params: Record<string, string>) {
  const paymentId = params.m_payment_id ?? '';
  const pfPaymentId = params.pf_payment_id ?? '';
  const paymentType = params.custom_str1 ?? '';

  console.log(
    `[PayFast ITN] Payment complete: ${pfPaymentId}`,
    { paymentId, type: paymentType, amount: params.amount_gross },
  );

  const supabase = await createClient();

  if (paymentType === 'equipment_booking') {
    // Update booking status to confirmed
    const { error: bookingErr } = await supabase
      .from('equipment_bookings')
      .update({
        status: 'confirmed',
        payfast_payment_id: pfPaymentId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', paymentId);

    if (bookingErr) {
      console.error('[PayFast ITN] Failed to confirm booking:', bookingErr.message);
    } else {
      // Create booking_payment record
      await supabase.from('booking_payments').insert({
        booking_id: paymentId,
        payfast_payment_id: pfPaymentId,
        amount: parseFloat(params.amount_gross ?? '0'),
        currency: 'ZAR',
        status: 'complete',
      });

      console.log('[PayFast ITN] Booking confirmed:', paymentId);
    }
  } else if (paymentType === 'subscription') {
    // custom_str2 = user_id, custom_str3 = plan_id, custom_str4 = billing cycle
    const userId = params.custom_str2 ?? '';

    // Update subscription status to active
    const { error: subErr } = await supabase
      .from('subscriptions')
      .update({
        status: 'active',
        payfast_token: pfPaymentId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', paymentId)
      .eq('user_id', userId);

    if (subErr) {
      console.error('[PayFast ITN] Failed to activate subscription:', subErr.message);
    } else {
      console.log('[PayFast ITN] Subscription activated:', paymentId);
    }
  }
}

async function handlePaymentFailed(params: Record<string, string>) {
  const paymentId = params.m_payment_id ?? '';
  const paymentType = params.custom_str1 ?? '';

  console.log(
    `[PayFast ITN] Payment failed: ${params.pf_payment_id}`,
    { paymentId, type: paymentType },
  );

  const supabase = await createClient();

  if (paymentType === 'equipment_booking') {
    await supabase
      .from('equipment_bookings')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', paymentId);
  } else if (paymentType === 'subscription') {
    await supabase
      .from('subscriptions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', paymentId);
  }
}

async function handlePaymentPending(params: Record<string, string>) {
  console.log(
    `[PayFast ITN] Payment pending: ${params.pf_payment_id}`,
    { paymentId: params.m_payment_id, type: params.custom_str1 },
  );
}

// ─── POST handler (receives ITN from PayFast) ──────────────────────────────

export async function POST(request: NextRequest) {
  if (!isPayFastConfigured()) {
    return NextResponse.json(
      { error: 'PayFast is not configured' },
      { status: 503 },
    );
  }

  // 1. Validate source IP
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() ?? '';

  if (!isPayFastIP(ip)) {
    console.error(`[PayFast ITN] Request from unauthorized IP: ${ip}`);
    return NextResponse.json({ error: 'Unauthorized IP' }, { status: 403 });
  }

  // 2. Parse form-encoded body
  const body = await request.text();
  const params: Record<string, string> = {};
  new URLSearchParams(body).forEach((value, key) => {
    params[key] = value;
  });

  // 3. Validate signature
  const receivedSignature = params.signature ?? '';
  if (!validateSignature(params, receivedSignature)) {
    console.error('[PayFast ITN] Signature validation failed');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // 4. Validate with PayFast server
  const isValid = await validateITN(params);
  if (!isValid) {
    console.error('[PayFast ITN] Server validation failed');
    return NextResponse.json({ error: 'ITN validation failed' }, { status: 400 });
  }

  // 5. Process payment based on status
  const paymentStatus = params.payment_status as PayFastPaymentStatus;

  try {
    switch (paymentStatus) {
      case 'COMPLETE':
        await handlePaymentComplete(params);
        break;
      case 'FAILED':
        await handlePaymentFailed(params);
        break;
      case 'PENDING':
        await handlePaymentPending(params);
        break;
      default:
        console.log(`[PayFast ITN] Unknown payment status: ${paymentStatus}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[PayFast ITN] Error processing ${paymentStatus}: ${message}`);
    return NextResponse.json(
      { error: 'ITN handler failed' },
      { status: 500 },
    );
  }

  // PayFast expects a 200 OK response
  return new NextResponse('OK', { status: 200 });
}
