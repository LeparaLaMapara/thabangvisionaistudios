export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { STUDIO } from '@/lib/constants';
import { appUrl } from '@/lib/app-url';
import { checkRateLimit } from '@/lib/auth';
import { logEvent } from '@/lib/data/events';
import { callbackStatus, referenceFromCallback, verifyAndConfirmServiceBooking } from '@/lib/payments/service-payment-check';

// ─── GET — Paystack redirects here after the client pays ─────────────────────
//
// Paystack is asked, server to server, whether the charge went through. When
// it did, the booking is confirmed here with the same guarded confirmation the
// webhook uses, so a lost or slow webhook no longer leaves a paid booking
// "waiting for payment" (it used to only redirect). Nothing in this URL counts
// as proof: only Paystack's own answer does. A webhook arriving later finds
// the booking already paid and changes nothing.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const reference = referenceFromCallback(searchParams);
  const baseUrl = appUrl(STUDIO.meta.url);
  const to = (status: string, ref?: string) =>
    NextResponse.redirect(`${baseUrl}/dashboard/bookings?status=${status}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`);

  if (!reference) {
    return to('error');
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!(await checkRateLimit(`svc-callback:${ip}`, 20, 60_000))) {
    // Not an answer about the payment: the bookings page still shows the truth.
    return to('error', reference);
  }

  try {
    const outcome = await verifyAndConfirmServiceBooking(reference);
    if (outcome.state === 'paid') {
      logEvent({
        eventType: 'service_payment_checked_on_return',
        eventCategory: 'payment',
        metadata: { reference, confirmation: outcome.confirmation },
      });
    }
    return to(callbackStatus(outcome), reference);
  } catch (err) {
    console.error('[service-bookings/callback] confirm failed:', err instanceof Error ? err.message : 'unknown error');
    return to('error', reference);
  }
}
