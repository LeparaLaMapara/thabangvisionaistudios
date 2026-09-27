export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { faqPageJsonLd, renderJsonLd } from '@/lib/seo/structured-data';
import { STUDIO } from '@/lib/constants';
import { ExitIntentModal } from '@/components/engagement/ExitIntentModal';

export const metadata: Metadata = buildPageMetadata({
  title: 'Pricing — Simple, Transparent Plans',
  description: `Free to join ${STUDIO.shortName}. Pay per booking: gear by the day or week, services by the package or the hour. The full price is shown before you pay.`,
  path: '/pricing',
});

const FAQ_ITEMS = [
  {
    question: 'How much does ThabangVision cost?',
    answer: 'Creating an account and browsing is free. You pay per booking: equipment hire is charged at the daily or weekly rate shown on each listing, plus a refundable security deposit, and production services are charged at the hourly rate shown on the booking page.',
  },
  {
    question: 'How does ThabangVision pay creators who supply gear or services?',
    answer: 'ThabangVision is the seller of record on every order, so customers pay ThabangVision directly. Where a verified creator supplies the item or service, ThabangVision retains a 15% commission and pays the creator the balance after the booking completes.',
  },
  {
    question: 'Can I supply my own equipment for hire?',
    answer: 'Yes. Once your identity is verified you can list gear as a ThabangVision supplier. Customers book and pay ThabangVision, we retain a 15% commission, and you are paid the balance after the hire completes.',
  },
  {
    question: 'What payment methods do you accept?',
    answer: 'We accept South African credit cards, debit cards, and EFT through our authorised payment gateway. All prices are in South African Rand (ZAR).',
  },
  {
    question: 'Does it cost anything to join?',
    answer: 'No. Creating an account, browsing rentals, booking equipment, and creating a creator profile are all free. You only pay for what you book.',
  },
];

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  const jsonLd = faqPageJsonLd(FAQ_ITEMS);

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
