import type { Metadata } from 'next';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Ubunye AI Studio',
  description:
    'Ubunye, the ThabangVision AI assistant. Ask about gear, dates and prices, or get help planning a shoot in Johannesburg.',
};

export default function UbunyeAILayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
