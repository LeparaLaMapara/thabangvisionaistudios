export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { faqPageJsonLd, renderJsonLd } from '@/lib/seo/structured-data';
import { STUDIO } from '@/lib/constants';
import { ExitIntentModal } from '@/components/engagement/ExitIntentModal';
import { onlinePaymentsOpen } from '@/lib/payments/status';
import { PAYMENTS_NOT_OPEN_NOTICE } from '@/lib/payments/offline-message';

export const metadata: Metadata = buildPageMetadata({
  title: 'Pricing',
  description: `Free to join ${STUDIO.shortName}. Pay per booking: gear by the day or week, shoots by the package. The full price is shown before you book, and it is the price you pay.`,
  path: '/pricing',
});

/** The answers follow the payment switch, like the page. */
function faqItems(paymentsOpen: boolean) {
  return [
    {
      question: `How much does ${STUDIO.shortName} cost?`,
      answer: 'Creating an account and browsing is free. You pay per booking: equipment hire is charged at the daily or weekly rate shown on each listing, plus a refundable security deposit, and shoots at the package price shown. The price shown is the price you pay.',
    },
    {
      question: 'What payment methods do you accept?',
      answer: paymentsOpen
        ? `We accept South African credit cards, debit cards, and EFT through our authorised payment gateway. All prices are in South African Rand.`
        : `${PAYMENTS_NOT_OPEN_NOTICE} All prices are in South African Rand.`,
    },
    {
      question: 'Does it cost anything to join?',
      answer: 'No. Creating an account and browsing are free. You only pay for what you book.',
    },
  ];
}

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  const jsonLd = faqPageJsonLd(faqItems(onlinePaymentsOpen()));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: renderJsonLd(jsonLd) }}
      />
      {children}
      <ExitIntentModal
        prompt="Help me choose gear or a package for my shoot"
        heading="Not sure what you need?"
        body="Ubunye can suggest gear or a package for your shoot and tell you the full price."
        ctaLabel="Ask Ubunye"
      />
    </>
  );
}
