import { STUDIO } from '@/lib/constants';
import { collectionPointWithCity } from '@/lib/rental/collection-point';

/**
 * "What happens next" on a gear booking, for every status, in the same words
 * the notices use (lib/rental/notify.ts). Pure, so it is tested.
 *
 * It says what we are waiting for, who acts, and what the renter needs to do
 * (often: nothing). It never promises a time we do not control (a bank, a
 * courier) and never invents a step the pipeline does not take.
 */

export interface NextStepFacts {
  status: string;
  start_date: string;
  end_date: string;
  fulfilment_method?: string | null;
  requires_manual_approval?: boolean | null;
  payment_method?: string | null;
}

export interface NextStep {
  title: string;
  lines: string[];
}

const day = (ymd: string): string =>
  new Date(`${ymd.slice(0, 10)}T12:00:00+02:00`).toLocaleDateString(STUDIO.currency.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Africa/Johannesburg',
  });

const hours = (): string => `${STUDIO.hours.weekday}, ${STUDIO.hours.weekend}`;

export function gearNextStep(b: NextStepFacts): NextStep {
  const delivery = b.fulfilment_method === 'delivery';
  const where = collectionPointWithCity();
  switch (b.status) {
    case 'pending':
      if (b.payment_method === 'eft' || b.payment_method === 'cash') {
        return {
          title: 'Waiting for your payment',
          lines: ['Your dates are held. Pay as shown above; the booking is confirmed once the payment is recorded.'],
        };
      }
      return {
        title: 'Waiting for your payment to be confirmed',
        lines: ['If you paid, the payment provider confirms it to us, usually within a few minutes, and this page updates. Please do not pay again.'],
      };
    case 'confirmed':
      return {
        title: delivery ? 'Your delivery is next' : `Collect on ${day(b.start_date)}`,
        lines: [
          delivery
            ? 'The delivery status is below. Have the ID you verified with ready when the gear arrives, and check every item before you confirm receipt.'
            : `Collect at ${where} (${hours()}). Bring the ID you verified with; we check the gear with you and photograph it at handover.`,
          ...(b.requires_manual_approval ? ['A person approves this booking before the gear is handed over. We let you know if we need anything.'] : []),
          ...(delivery ? [] : ['You get a reminder on the morning of collection.']),
          'Need to change plans? Cancel below: what you get back is shown before you confirm.',
        ],
      };
    case 'active':
      return {
        title: `Return on ${day(b.end_date)}`,
        lines: [
          delivery
            ? 'Your hire is on. How to return it is shown below.'
            : `Your hire is on. Bring everything back to ${where} (${hours()}) with all accessories.`,
          'Something wrong with the gear? Report it below straight away.',
        ],
      };
    case 'overdue':
      return {
        title: 'Your gear is overdue',
        lines: [
          `The hire ended on ${day(b.end_date)}. Please return it as soon as you can${STUDIO.whatsapp?.display ? `, or tell us on ${STUDIO.whatsapp.display} when you will` : ''}. Any late fee follows the published rule.`,
        ],
      };
    case 'return_pending':
      return {
        title: 'Returned: we are checking the gear',
        lines: ['We inspect each item against the photos taken at handover, then settle your deposit. You do not need to do anything.'],
      };
    case 'return_reviewed':
      return {
        title: 'Inspected: your deposit is being settled',
        lines: ['Any deposit refund is listed under Payments and refunds below, with its status.'],
      };
    case 'completed':
      return {
        title: 'Hire complete',
        lines: ['Thank you. Your deposit settlement is under Payments and refunds below.'],
      };
    case 'disputed':
      return {
        title: 'A person is looking at this hire',
        lines: ['Nothing is decided until they have. Follow it and add detail under Disputes.'],
      };
    case 'cancelled':
      return {
        title: 'Cancelled',
        lines: ['Any refund is listed under Payments and refunds below, with its status. Refunds go back to the card you paid with.'],
      };
    default:
      return { title: 'Your booking', lines: [] };
  }
}
