import type { Metadata } from 'next';
import { PLAN, STUDIO } from '@/lib/constants';
import { buildPageMetadata } from '@/lib/seo/metadata';

export const revalidate = 60;

export const metadata: Metadata = buildPageMetadata({
  title: 'Plan a shoot',
  description: `Say what you are planning and Ubunye, the ${STUDIO.shortName} AI, brings the people and gear together, with dates and prices, in ${STUDIO.serviceArea.province}. Prices are confirmed at checkout.`,
  path: PLAN.href,
});

export default function PlanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
