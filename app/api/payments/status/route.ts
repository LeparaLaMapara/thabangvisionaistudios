import { NextResponse } from 'next/server';
import { onlinePaymentsOpen } from '@/lib/payments/status';

export const dynamic = 'force-dynamic';

/**
 * GET /api/payments/status: { open: boolean }. Read by client components that
 * change their wording when online payment is closed (the cart button, for
 * one). Says nothing about keys or providers, only whether paying works.
 */
export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ open: onlinePaymentsOpen() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ open: false }, { status: 200 });
  }
}
