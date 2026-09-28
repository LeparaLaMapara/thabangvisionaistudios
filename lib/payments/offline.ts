import { email as emailProvider } from '@/lib/email';
import { logEvent } from '@/lib/data/events';
import { STUDIO } from '@/lib/constants';

/**
 * Online payment is off (no live keys). A booking request is still saved, the
 * person is told plainly that we will contact them to pay, and the owner is
 * emailed at once so a real customer is never left waiting on nothing.
 */
export { PAYMENTS_OFF_MESSAGE } from './offline-message';

export function reportUnpaidRequest(params: {
  kind: 'gear' | 'cart' | 'service';
  reference: string;
  userId: string;
  userEmail: string | null | undefined;
  amount: number;
  summary: string;
}): void {
  logEvent({
    eventType: 'booking_blocked',
    eventCategory: 'booking',
    userId: params.userId,
    metadata: { reason: 'payments_off', kind: params.kind, reference: params.reference, amount: params.amount },
  });

  emailProvider
    .sendEmail({
      to: STUDIO.bookingEmail,
      subject: `[Booking request] ${params.summary} (online payment is off)`,
      text: [
        `Someone tried to book and pay, but online payment is switched off, so nothing was charged.`,
        '',
        `What: ${params.summary}`,
        `Amount: ${STUDIO.currency.symbol}${params.amount.toLocaleString(STUDIO.currency.locale)}`,
        `Reference: ${params.reference}`,
        `Customer: ${params.userEmail ?? '(no email)'}`,
        '',
        'They were told we will contact them to arrange payment. Please reply to them today.',
      ].join('\n'),
    })
    .catch((err) => console.error('[payments] unpaid request email failed:', err));
}
