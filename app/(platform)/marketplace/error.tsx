'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';

export default function MarketplaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Marketplace Error]', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0A0B] flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <p className="text-[10px] font-mono uppercase tracking-widest text-red-500 mb-4">
          Error
        </p>
        <h2 className="text-2xl font-display font-medium uppercase text-black dark:text-white mb-3">
          Something went wrong
        </h2>
        <p className="text-sm text-neutral-500 font-mono mb-8">
          We encountered an error loading the marketplace. Please try again.
        </p>
        <Button onClick={reset}>Try Again</Button>
      </div>
    </div>
  );
}
