import { getFlag, type FeatureKey } from '@/lib/features';

interface FeatureGateProps {
  flag: FeatureKey;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export async function FeatureGate({
  flag,
  children,
  fallback = null,
}: FeatureGateProps) {
  const enabled = await getFlag(flag);
  return <>{enabled ? children : fallback}</>;
}
