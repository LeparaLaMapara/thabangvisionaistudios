export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { paystackKeyMode } from '@/lib/payments/paystack';
import { onlinePaymentsOpen } from '@/lib/payments/status';

/**
 * Whether this deployment can take money, without showing any key: each key
 * is reported only as live, test, missing or unrecognised. Admin only.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const secret = paystackKeyMode(process.env.PAYSTACK_SECRET_KEY);
  const publicKey = paystackKeyMode(process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY);
  const rawUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

  return NextResponse.json({
    environment: process.env.VERCEL_ENV ?? 'local',
    provider: process.env.PAYMENT_PROVIDER?.trim() || 'paystack',
    paymentsOff: process.env.PAYMENTS_OFF?.trim() === 'true',
    onlinePaymentsOpen: onlinePaymentsOpen(),
    paystack: {
      secretKey: secret,
      publicKey,
      // A live public key with a test secret (or the reverse) fails at checkout.
      keysMatch: secret === publicKey,
    },
    yoco: {
      secretKey: process.env.YOCO_SECRET_KEY?.trim() ? 'set' : 'missing',
      webhookSecret: process.env.YOCO_WEBHOOK_SECRET?.trim() ? 'set' : 'missing',
    },
    appUrlHasWhitespace: rawUrl !== rawUrl.trim(),
  });
}
