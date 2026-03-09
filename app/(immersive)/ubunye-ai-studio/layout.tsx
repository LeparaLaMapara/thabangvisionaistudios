import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ubunye AI Studio',
  description:
    'Ubunye AI Studio — AI tools, automation, and creative intelligence for film and virtual production. Explore virtual production, remote systems, lighting science, data workflows, and custom AI labs.',
};

export default function UbunyeAILayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
