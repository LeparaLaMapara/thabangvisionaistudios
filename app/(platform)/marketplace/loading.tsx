import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function MarketplaceLoading() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0A0B] flex items-center justify-center">
      <LoadingSpinner size="lg" label="Loading marketplace" />
    </div>
  );
}
