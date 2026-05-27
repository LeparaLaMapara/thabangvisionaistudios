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
    answer: 'ThabangVision offers three plans: Starter (free), Pro Creator (R299/month or R2,990/year), and Studio (R799/month or R7,990/year). All plans include access to equipment rentals and booking.',
  },
  {
    question: 'What is the platform fee on rentals?',
    answer: 'Platform fees depend on your plan: Starter pays 10%, Pro Creator pays 7%, and Studio pays 5% on community rental transactions.',
  },
  {
    question: 'Can I list my own equipment for rent?',
    answer: 'Yes. Starter accounts can list up to 3 items. Pro Creator and Studio accounts get unlimited listings plus featured listing credits.',
  },
  {
    question: 'What payment methods do you accept?',
    answer: 'We accept credit cards, debit cards, and EFT via our secure payment partner Paystack. All prices are in South African Rand (ZAR).',
  },
  {
    question: 'Is there a free trial?',
    answer: 'The Starter plan is permanently free. You can browse all rentals, book equipment, and create a basic creator profile at no cost.',
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
