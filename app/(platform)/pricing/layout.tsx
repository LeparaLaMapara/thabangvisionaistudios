export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { faqPageJsonLd, renderJsonLd } from '@/lib/seo/structured-data';
import { STUDIO } from '@/lib/constants';
import { ExitIntentModal } from '@/components/engagement/ExitIntentModal';

export const metadata: Metadata = buildPageMetadata({
  title: 'Pricing — Simple, Transparent Plans',
  description: `Start free on ${STUDIO.shortName}. Upgrade to Pro Creator (R299/mo) or Studio (R799/mo) for lower fees, verified badges, and unlimited listings.`,
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
    answer: 'We accept credit cards, debit cards, and EFT via our secure payment partner Paystack. All prices are in South African Rand (ZAR).',
  },
  {
    question: 'Does it cost anything to join?',
    answer: 'No. Creating an account, browsing rentals, booking equipment, and creating a creator profile are all free. You only pay for what you book.',
  },
  {
    question: 'How do I cancel my subscription?',
    answer: 'You can cancel your Pro Creator or Studio subscription at any time from your dashboard. Your plan remains active until the end of the billing period.',
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
        prompt="Help me choose the right plan for my needs"
        heading="Not sure which plan?"
        body="Our AI assistant can recommend the perfect plan based on your needs — whether you're a solo creator or a full production house."
        ctaLabel="Get a recommendation"
      />
    </>
  );
}
