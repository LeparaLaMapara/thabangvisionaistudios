import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ubunye AI Studio',
  description:
    'Ubunye AI Studio — Your AI production assistant. Plan shoots, find gear, hire crew, and get instant quotes for photography and film production across South Africa.',
};

export default function UbunyeAILayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
