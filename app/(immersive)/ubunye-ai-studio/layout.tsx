import type { Metadata } from 'next';
import { STUDIO } from '@/lib/constants';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Ubunye AI Studio',
  description: `Ubunye, the ${STUDIO.shortName} AI assistant. Ask about gear, dates and prices, or get help planning a shoot in ${STUDIO.serviceArea.province}. Prices are confirmed at checkout.`,
};

export default function UbunyeAILayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
