/**
 * What a renter sees under "Payments and refunds" on a gear booking. Pure, so
 * it is tested.
 *
 * Built from the records that actually hold the money: the order's payment
 * intent (070; the provider-verified charge), the recorded payment lines for
 * older or hand-settled orders (`booking_payments`, rands), and the refund
 * obligations (070; one per refund, in cents). Nothing is inferred: no
 * "refunded" before the provider has processed it, no charge before one is
 * recorded. The words match the notices (lib/rental/notify.ts):
 * "initiated", "processed", "could not be completed automatically".
 */

export interface IntentFacts {
  state: string;
  expected_amount_cents: number;
  hire_cents: number;
  deposit_cents: number;
  delivery_cents: number;
  paid_at: string | null;
}

export interface PaymentLineFacts {
  booking_id: string;
  amount: number | string;
  status: string;
  created_at: string;
}

export interface RefundFacts {
  id: string;
  reason: string;
  state: string;
  amount_cents: number;
  booking_ids: string[] | null;
  created_at: string;
  processed_at: string | null;
}

export type RefundStage = 'preparing' | 'initiated' | 'processed' | 'needs_person';

export interface MoneyView {
  /** What was charged and when, or null while nothing has been charged. */
  charged: {
    totalCents: number;
    hireCents: number | null;
    depositCents: number | null;
    deliveryCents: number | null;
    at: string | null;
    /** True when the charge covers more items than this booking (one cart order). */
    wholeOrder: boolean;
  } | null;
  /** The payment is still being confirmed by the provider (never shown as paid). */
  awaitingConfirmation: boolean;
  refunds: {
    id: string;
    label: string;
    amountCents: number;
    stage: RefundStage;
    stageText: string;
    at: string;
    /** True when the refund is for the whole order, not only this item. */
    wholeOrder: boolean;
  }[];
}

const toCents = (rands: number | string): number => Math.round(Number(rands) * 100);

export const REFUND_REASON_LABEL: Readonly<Record<string, string>> = {
  cancellation: 'Cancellation refund',
  deposit_settlement: 'Deposit returned',
  late_payment: 'Payment that arrived after your hold ended',
  overpayment: 'Amount paid twice or too much',
  manual: 'Refund',
};

/** The obligation states in the customer's words. */
export function refundStage(state: string): { stage: RefundStage; text: string } {
  switch (state) {
    case 'processed':
      return { stage: 'processed', text: 'Refunded by the payment provider. When it shows on your statement depends on your bank.' };
    case 'requested':
    case 'pending':
    case 'processing':
      return { stage: 'initiated', text: 'Sent to the payment provider. Banks usually take a few working days.' };
    case 'eligible':
    case 'claimed':
      return { stage: 'preparing', text: 'Approved and about to be sent to the payment provider.' };
    default:
      // failed, needs_attention, disputed: never a dead end, never blame.
      return { stage: 'needs_person', text: 'This could not be completed automatically. A person on our team is completing it and will contact you.' };
  }
}

export function bookingMoneyView(p: {
  bookingId: string;
  /** Lines in the same cart order (including this one). 1 when not a cart order. */
  orderLineCount: number;
  intent: IntentFacts | null;
  payments: PaymentLineFacts[];
  refunds: RefundFacts[];
}): MoneyView {
  const wholeOrder = p.orderLineCount > 1;
  let charged: MoneyView['charged'] = null;
  let awaitingConfirmation = false;

  if (p.intent && p.intent.state !== 'initiated' && p.intent.state !== 'failed' && p.intent.state !== 'expired' && p.intent.state !== 'mismatch') {
    // paid, refund_due, refunded: the charge happened.
    charged = {
      totalCents: p.intent.expected_amount_cents,
      hireCents: p.intent.hire_cents,
      depositCents: p.intent.deposit_cents,
      deliveryCents: p.intent.delivery_cents > 0 ? p.intent.delivery_cents : null,
      at: p.intent.paid_at,
      wholeOrder,
    };
  } else {
    // Older orders and payments recorded by hand (EFT, cash): the succeeded lines.
    const succeeded = p.payments.filter((x) => x.status === 'succeeded');
    if (succeeded.length > 0) {
      const latest = succeeded.map((x) => x.created_at).sort().at(-1) ?? null;
      charged = {
        totalCents: succeeded.reduce((sum, x) => sum + toCents(x.amount), 0),
        hireCents: null,
        depositCents: null,
        deliveryCents: null,
        at: latest,
        wholeOrder: wholeOrder && succeeded.some((x) => x.booking_id !== p.bookingId),
      };
    } else if (p.intent?.state === 'initiated' || p.payments.some((x) => x.status === 'pending')) {
      awaitingConfirmation = true;
    }
  }

  const refunds = p.refunds
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((r) => {
      const { stage, text } = refundStage(r.state);
      const ids = r.booking_ids ?? [];
      return {
        id: r.id,
        label: REFUND_REASON_LABEL[r.reason] ?? 'Refund',
        amountCents: r.amount_cents,
        stage,
        stageText: text,
        at: r.processed_at ?? r.created_at,
        wholeOrder: wholeOrder && !(ids.length === 1 && ids[0] === p.bookingId),
      };
    });

  return { charged, awaitingConfirmation, refunds };
}
