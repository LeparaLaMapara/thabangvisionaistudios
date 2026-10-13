import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifySignature } from '@/lib/payments/paystack';
import { approveTransferRequest, type PayoutState } from '@/lib/core/rental/payouts';
import { toCents } from '@/lib/core/pricing/money';
import { logEvent } from '@/lib/data/events';

export const dynamic = 'force-dynamic';

/**
 * Paystack Transfer Approval URL (spec §7.8).
 *
 * When enabled in the Paystack dashboard, Paystack asks this endpoint before
 * every transfer. We approve (200) only a transfer that matches an
 * instruction we created: same reference, exact amount, same recipient,
 * currently being sent. Everything else is refused (400). That covers a
 * leaked secret key, a replayed request, or a changed amount or recipient.
 *
 * Fails closed: no valid signature or an unreadable body means refuse.
 *
 * NEEDS TEST-MODE VERIFICATION: the exact request shape and the approve/
 * reject status codes are taken from Paystack's documentation as understood;
 * they could not be confirmed from this environment. Verify in test mode
 * before enabling the approval URL on the live account.
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('x-paystack-signature') ?? '';
  if (!process.env.PAYSTACK_SECRET_KEY || !signature || !verifySignature(body, signature)) {
    return NextResponse.json({ approved: false, reason: 'invalid_signature' }, { status: 400 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ approved: false, reason: 'invalid_body' }, { status: 400 });
  }
  const data = (typeof payload.data === 'object' && payload.data !== null ? payload.data : payload) as Record<string, unknown>;
  const recipient = (typeof data.recipient === 'object' && data.recipient !== null ? data.recipient : {}) as Record<string, unknown>;
  const request_ = {
    reference: String(data.reference ?? ''),
    amountCents: Number(data.amount),
    recipientCode: String(recipient.recipient_code ?? data.recipient_code ?? data.recipient ?? ''),
    currency: String(data.currency ?? 'ZAR').toUpperCase(),
  };

  const db = createAdminClient();
  let decision: { approve: boolean; reason: string } = { approve: false, reason: 'unknown_reference' };

  // Gear owner payout?
  const { data: payout } = await db
    .from('owner_payouts')
    .select('transfer_reference, owner_amount_cents, recipient_code, state')
    .eq('transfer_reference', request_.reference)
    .maybeSingle();
  if (payout) {
    const p = payout as { transfer_reference: string; owner_amount_cents: number; recipient_code: string | null; state: PayoutState };
    decision = approveTransferRequest(request_, { reference: p.transfer_reference, amountCents: p.owner_amount_cents, recipientCode: p.recipient_code ?? '', state: p.state });
  } else {
    // Creator payout on a service booking (lib/payments/payout.ts).
    const { data: booking } = await db
      .from('bookings')
      .select('payout_reference, payout_status, creator_amount, creator_id')
      .eq('payout_reference', request_.reference)
      .maybeSingle();
    if (booking) {
      const b = booking as { payout_reference: string; payout_status: string; creator_amount: number | null; creator_id: string };
      const { data: bank } = await db.from('banking_details').select('paystack_recipient_code').eq('user_id', b.creator_id).maybeSingle();
      decision = approveTransferRequest(request_, {
        reference: b.payout_reference,
        amountCents: toCents(Number(b.creator_amount ?? 0)),
        recipientCode: (bank as { paystack_recipient_code?: string } | null)?.paystack_recipient_code ?? '',
        state: b.payout_status === 'processing' ? 'claimed' : 'success',
      });
    }
  }

  logEvent({
    eventType: decision.approve ? 'transfer_approved' : 'transfer_refused',
    eventCategory: 'payout',
    metadata: { reference: request_.reference, reason: decision.reason },
  });
  return decision.approve
    ? NextResponse.json({ approved: true }, { status: 200 })
    : NextResponse.json({ approved: false, reason: decision.reason }, { status: 400 });
}
