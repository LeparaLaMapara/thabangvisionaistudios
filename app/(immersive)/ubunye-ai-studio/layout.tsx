import type { Metadata } from 'next';
import { STUDIO } from '@/lib/constants';
import { buildPageMetadata } from '@/lib/seo/metadata';

export const revalidate = 60;

export const metadata: Metadata = buildPageMetadata({
  title: 'Ask Ubunye',
  description: `Ubunye, the ${STUDIO.shortName} AI assistant. Ask about gear, dates and prices, or get help planning a shoot in ${STUDIO.serviceArea.province}. Prices are confirmed at checkout.`,
  path: '/ubunye-ai-studio',
});

export default function UbunyeAILayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
