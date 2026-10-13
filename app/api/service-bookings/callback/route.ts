export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { verifyPayment } from '@/lib/payments/routing';
import { STUDIO } from '@/lib/constants';
import { appUrl } from '@/lib/app-url';

// ─── GET — Paystack redirects here after client pays ─────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const reference = searchParams.get('reference');
  const baseUrl = appUrl(STUDIO.meta.url);

  if (!reference) {
    return NextResponse.redirect(`${baseUrl}/dashboard/bookings?error=missing_reference`);
  }

  try {
    const result = await verifyPayment(reference);

    if (result.success) {
      return NextResponse.redirect(
        `${baseUrl}/dashboard/bookings?status=success&ref=${reference}`,
      );
    }

    return NextResponse.redirect(`${baseUrl}/dashboard/bookings?status=failed`);
  } catch {
    return NextResponse.redirect(`${baseUrl}/dashboard/bookings?status=error`);
  }
}
