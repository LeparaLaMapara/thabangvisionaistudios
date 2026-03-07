import { NextRequest, NextResponse } from 'next/server';
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

  if (paymentType === 'equipment_booking') {
    // TODO: Look up equipment_bookings by m_payment_id (our internal booking ID),
    // set status to 'confirmed', create booking_payment record with pf_payment_id,
    // and auto-generate an invoice record.
    console.log('[PayFast ITN] Booking confirmed:', paymentId);
  } else if (paymentType === 'subscription') {
    // TODO: Look up subscription by m_payment_id,
    // confirm subscription status as 'active'.
    console.log('[PayFast ITN] Subscription payment:', paymentId);
  }
}

async function handlePaymentFailed(params: Record<string, string>) {
  const paymentId = params.m_payment_id ?? '';
  const paymentType = params.custom_str1 ?? '';

  console.log(
    `[PayFast ITN] Payment failed: ${params.pf_payment_id}`,
    { paymentId, type: paymentType },
  );

  // TODO: Update booking/order/subscription status to reflect failed payment
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
