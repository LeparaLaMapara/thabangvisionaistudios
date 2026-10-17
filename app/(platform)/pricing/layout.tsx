export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { faqPageJsonLd, renderJsonLd } from '@/lib/seo/structured-data';
import { PLAN, STUDIO } from '@/lib/constants';
import { ExitIntentModal } from '@/components/engagement/ExitIntentModal';
import { onlinePaymentsOpen } from '@/lib/payments/status';
import { PAYMENTS_NOT_OPEN_NOTICE } from '@/lib/payments/offline-message';
import { activePaymentProviderLabel } from '@/lib/consent/legal-facts';
import { PaymentProviderNameProvider } from '@/components/payments/PaymentProviderName';

export const metadata: Metadata = buildPageMetadata({
  title: 'Pricing',
  description: `Free to join ${STUDIO.shortName}. Pay per booking: gear by the day or week, shoots by the package. The full price is shown before you book, and it is the price you pay.`,
  path: '/pricing',
});

/** The answers follow the payment switch, like the page. */
function faqItems(paymentsOpen: boolean, provider: string) {
  return [
    {
      question: `How much does ${STUDIO.shortName} cost?`,
      answer: 'Creating an account and browsing is free. You pay per booking: rentals are charged at the daily or weekly rate shown on each listing, plus a refundable security deposit, and shoots at the package price shown. The price shown is the price you pay.',
    },
    {
      question: 'What payment methods do you accept?',
      answer: paymentsOpen
        ? `South African credit and debit cards, through ${provider}, our payment provider. All prices are in South African Rand.`
        : `${PAYMENTS_NOT_OPEN_NOTICE} All prices are in South African Rand.`,
    },
    {
      question: 'Does it cost anything to join?',
      answer: 'No. Creating an account and browsing are free. You only pay for what you book.',
    },
  ];
}

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  const provider = activePaymentProviderLabel();
  const jsonLd = faqPageJsonLd(faqItems(onlinePaymentsOpen(), provider));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: renderJsonLd(jsonLd) }}
      />
      <PaymentProviderNameProvider name={provider}>{children}</PaymentProviderNameProvider>
      <ExitIntentModal
        prompt="Help me choose gear or a package for my shoot"
        heading="Not sure what you need?"
        body="Ubunye can suggest gear or a package for your shoot and tell you the full price."
        ctaLabel={PLAN.cta}
      />
    </>
  );
}
