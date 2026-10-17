import { STUDIO, RENTAL_POLICY } from '@/lib/constants';
import { PAYMENTS_NOT_OPEN_NOTICE } from '@/lib/payments/offline-message';
import { collectionPointWithCity } from '@/lib/rental/collection-point';
import { formatRand } from '@/lib/format/money';

/**
 * The questions every visitor asks before they book, answered from the same
 * settings checkout enforces, so an answer can never drift from the rule.
 *
 * The FAQ page showed "No FAQs published yet. Ask Ubunye AI instead": the only
 * way to learn how renting works was to chat. These are always shown; FAQs the
 * owner publishes in /admin/faqs appear alongside them.
 */
export interface CoreFaq {
  id: string;
  category: 'booking' | 'pricing' | 'equipment' | 'creators' | 'platform' | 'general';
  question: string;
  answer: string;
}

const hoursToText = (h: number): string => (h % 24 === 0 ? `${h / 24} day${h === 24 ? '' : 's'}` : `${h} hours`);

/**
 * `paymentsOpen` is onlinePaymentsOpen() from the server. While online
 * payment is closed the answers say how payment really happens (EFT, cash or
 * cash at collection); they switch back by themselves when it opens. Without the
 * argument the answers take the cautious (closed) wording.
 */
export function coreFaqs(opts: { paymentsOpen?: boolean; rolesOn?: boolean } = {}): CoreFaq[] {
  const paymentsOpen = opts.paymentsOpen === true;
  // People (roles_v1): a person is booked on their People profile, the one way to book.
  const rolesOn = opts.rolesOn === true;
  const notice = STUDIO.rental.minLeadTimeHours;
  const delivery = STUDIO.fulfilment.delivery;
  const limits = RENTAL_POLICY.trustTierLimitsCents;
  const steps = RENTAL_POLICY.trustThresholds;
  const tiers = STUDIO.rental.cancellationTiers;
  const discounts = STUDIO.rental.bulkDiscount.filter((d) => d.discountPercent > 0);
  const vat = STUDIO.legal.tax.vatRate;

  const cancellation = tiers
    .map((t, i) => {
      if (t.minHoursBefore === 0) return `less than ${hoursToText(tiers[i - 1]?.minHoursBefore ?? 24)} before: ${t.refundPercent}%`;
      return `${hoursToText(t.minHoursBefore)} or more before: ${t.refundPercent}%`;
    })
    .join('; ');

  const bulk = discounts
    .map((d) => (d.maxItems === Infinity ? `${d.minItems} or more items: ${d.discountPercent}% off` : `${d.minItems} to ${d.maxItems} items: ${d.discountPercent}% off`))
    .join('; ');

  return [
    {
      id: 'core-how-rent',
      category: 'equipment',
      question: 'How do I rent a camera?',
      answer: paymentsOpen
        ? `Open the item, pick your dates and you will see whether it is available and the full price. Press to book, sign in (or create a free account), do a one-time ID check before your first rental, and pay online.`
        : `Open the item, pick your dates and you will see whether it is available and the full price. Press to book, sign in (or create a free account) and do a one-time ID check before your first rental. Then pay by EFT to our business account within ${STUDIO.bank.payWithinHours} hours (your booking shows the amount, the reference and our bank details), or pay in cash when you collect.`,
    },
    {
      id: 'core-limits',
      category: 'equipment',
      question: 'Is there a limit on how much gear I can rent?',
      answer: `Yes. The limit is the total replacement value of gear you have booked or out at once, and it grows with what we have verified and your hire history: ${formatRand(limits.contactable / 100)} with a verified email and phone number, ${formatRand(limits.verified / 100)} once your ID check is approved and a bank account in your name is validated, ${formatRand(limits.proven / 100)} after ${steps.proven.cleanReturns} on-time, good-condition return and ${steps.proven.historyDays} days since it, and ${formatRand(limits.trusted / 100)} after ${steps.trusted.cleanReturns} such returns covering ${formatRand(steps.trusted.cleanReturnValueCents / 100)} of gear and ${steps.trusted.historyDays} days since your first. Your first hire is collected in person so we can hand it over with you. Need more? Contact us and we will arrange it.`,
    },
    {
      id: 'core-notice',
      category: 'booking',
      question: 'How far ahead must I book gear?',
      answer: `At least ${hoursToText(notice)} before the day you want it, so we can check and pack it. The calendar only offers dates you can book.`,
    },
    {
      id: 'core-collect-deliver',
      category: 'equipment',
      question: 'Do I collect the gear or do you deliver?',
      answer: `Your first hire is collected in person at ${collectionPointWithCity()}, so we can hand it over with you. After that, collect it there or we deliver within ${delivery.maxRadiusKm} km at R${delivery.ratePerKm} per km (minimum R${delivery.minimumFee}), plus R${delivery.surchargePerExtraItem} for each item after the first ${delivery.itemsIncluded}. Any item worth more than ${formatRand(RENTAL_POLICY.highValueCollectionThresholdCents / 100)} is always collected. The delivery fee is shown before you book.`,
    },
    {
      id: 'core-delivery-tracking',
      category: 'equipment',
      question: 'How do I follow my delivery?',
      answer: `Your booking page shows each step. When a courier carries your gear it also shows a live tracking link and a PIN: give the PIN to the driver only when they hand you the gear. We email you when the gear is on its way and when it arrives, and send a phone notification if you turned them on. Have the ID you verified with ready: a courier driver checks it before handing over.`,
    },
    {
      id: 'core-area',
      category: 'general',
      question: 'Where do you work?',
      answer: `In ${STUDIO.serviceArea.province}. Gear is collected at ${collectionPointWithCity()} or delivered as described above. ${STUDIO.serviceArea.outsideProvinceNote} Ask us before you book.`,
    },
    {
      id: 'core-deposit',
      category: 'pricing',
      question: 'What is the deposit and when do I get it back?',
      answer: `Each item has a refundable security deposit, a fixed amount shown on the item before you book. ${paymentsOpen ? 'At checkout you pay it with your order' : 'When we confirm your booking you pay it with your order'}, together with the hire charge or on its own if you settle the hire charge when you collect. We check the gear when it comes back and refund the deposit, less any damage or late-return charges. The details are on our Refunds page.`,
    },
    {
      id: 'core-id',
      category: 'platform',
      question: 'Why do you need my ID, and how long does the check take?',
      answer: `Because the gear is valuable, we check who is renting it once, before your first rental: a photo of your ID and a selfie holding it. No certified copy is needed. A person checks it, ${STUDIO.verification.reviewTime}, and we email you the result. Your ID images are deleted ${STUDIO.legal.popia.retentionDays} days after the check.`,
    },
    {
      id: 'core-vat',
      category: 'pricing',
      // Founder decision 2026-10-08: not VAT-registered, so no VAT is added.
      // The registered wording comes back by itself when the setting changes.
      question: STUDIO.legal.vatRegistered ? 'Are prices including VAT?' : 'Is VAT added to the price?',
      answer: STUDIO.legal.vatRegistered
        ? `Yes. Every price is shown including VAT (${vat}%): gear, shoots and packages. Your quote shows the VAT part separately, and you always see the total before you book.`
        : `No. The price shown for gear, shoots and packages is the price you pay; no VAT is added. If you choose delivery, its fee is shown with the total before you book.`,
    },
    {
      id: 'core-cancel',
      category: 'booking',
      question: 'Can I cancel a gear booking?',
      answer: `Yes, from your dashboard. Cancel within ${STUDIO.legal.coolingOffDays} days of booking, before the hire starts, and everything you paid online comes back. After that the hire charge is refunded by how much notice you give (${cancellation}), and a deposit you paid online is refunded in full. You see the amount before you confirm.`,
    },
    {
      id: 'core-bulk',
      category: 'pricing',
      question: 'Is there a discount for renting several items?',
      answer: `Yes, when you rent them together through the cart: ${bulk}.`,
    },
    {
      id: 'core-city',
      category: 'equipment',
      question: `Can I rent camera gear in ${STUDIO.location.city}?`,
      answer: `Yes. ${STUDIO.name} is based in ${STUDIO.location.city}. Collect your gear at ${collectionPointWithCity()}, or after your first hire have it delivered within ${delivery.maxRadiusKm} km. Every item shows its price per day and its deposit before you book, and the calendar shows which dates are free.`,
    },
    {
      id: 'core-verified',
      category: 'creators',
      question: `What does "verified" mean on ${STUDIO.shortName}?`,
      answer: `It means a person at ${STUDIO.shortName} has checked who they are: a photo of their ID and a selfie holding it. A creator you can book has passed that check, is open for work and has at least one complete portfolio project. A member who lists their own gear must pass the same ID check and add a bank account we have validated before the listing can go live.`,
    },
    {
      id: 'core-photographer',
      category: 'creators',
      question: 'How do I book a photographer or videographer?',
      answer: rolesOn
        ? 'Go to People and choose a person. Each profile shows their price. Pick your days, see the total, and send a request. Nothing is paid when you ask: we confirm the booking with you first. You see who is coming once your booking is confirmed.'
        : `Shoots are by request for now. Choose a package on the Studio page and send a request, and we contact you to confirm who will shoot it, the date and the price. You see the full price before you send it.`,
    },
    ...(paymentsOpen
      ? []
      : [{
          id: 'core-payment',
          category: 'pricing' as const,
          question: 'How do I pay?',
          answer: `${PAYMENTS_NOT_OPEN_NOTICE} Nothing is charged when you send a booking.`,
        }]),
    {
      id: 'core-human',
      category: 'general',
      question: 'Can I talk to a person?',
      answer: `Yes. WhatsApp ${STUDIO.whatsapp.display} or email ${STUDIO.email}; we reply ${STUDIO.responseTime}. You can also plan your shoot with Ubunye, our AI assistant, at any time.`,
    },
  ];
}
