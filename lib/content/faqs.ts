import { STUDIO } from '@/lib/constants';

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

export function coreFaqs(): CoreFaq[] {
  const notice = STUDIO.rental.minLeadTimeHours;
  const delivery = STUDIO.fulfilment.delivery;
  const tiers = STUDIO.rental.cancellationTiers;
  const discounts = STUDIO.rental.bulkDiscount.filter((d) => d.discountPercent > 0);
  const vat = STUDIO.booking.vatRate;

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
      answer: `Open the item, pick your dates and you will see whether it is available and the full price. Press to book, sign in (or create a free account), do a one-time ID check before your first rental, and pay online.`,
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
      answer: `Either. Collect it in ${STUDIO.fulfilment.dispatchFrom.name}, Johannesburg, or we deliver within ${delivery.maxRadiusKm} km at R${delivery.ratePerKm} per km (minimum R${delivery.minimumFee}). The delivery fee is shown before you pay.`,
    },
    {
      id: 'core-deposit',
      category: 'pricing',
      question: 'What is the deposit and when do I get it back?',
      answer: `Each item has a refundable security deposit, a fixed amount shown on the item before you book. Booking one item from its page, you pay the deposit when you collect; checking out from the cart, it is paid online with your order. We check the gear when it comes back and refund the deposit, less any damage or late-return charges. The details are on our Refunds page.`,
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
      question: 'Are prices including VAT?',
      answer: `Gear prices include VAT. Photographer, videographer and editing prices are shown excluding VAT, and ${vat}% VAT is added at checkout. You always see the total before you pay.`,
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
      id: 'core-photographer',
      category: 'creators',
      question: 'How do I book a photographer or videographer?',
      answer: `Choose a package on the Studio page, pick the date and place, and pay. You see the price and VAT before you pay. We confirm the photographer with you, and they are paid only after the work is delivered.`,
    },
    {
      id: 'core-human',
      category: 'general',
      question: 'Can I talk to a person?',
      answer: `Yes. Call ${STUDIO.phone} or email ${STUDIO.email}. You can also ask Ubunye, our assistant, at any time.`,
    },
  ];
}
