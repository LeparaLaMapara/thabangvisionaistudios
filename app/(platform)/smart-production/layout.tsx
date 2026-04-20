import { notFound } from 'next/navigation';
import { getFlag } from '@/lib/features';

export default async function SmartProductionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const enabled = await getFlag('smart_productions');
  if (!enabled) notFound();
  return <>{children}</>;
}
