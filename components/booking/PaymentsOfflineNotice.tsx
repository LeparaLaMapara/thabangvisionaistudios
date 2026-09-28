'use client';

import { useSearchParams } from 'next/navigation';
import { Info } from 'lucide-react';
import { PAYMENTS_OFF_MESSAGE } from '@/lib/payments/offline-message';

/** Shown after a booking request when online payment is switched off. */
export function PaymentsOfflineNotice() {
  const params = useSearchParams();
  if (params.get('payment') !== 'offline') return null;
  return (
    <div role="status" className="flex items-start gap-3 p-4 mb-6 bg-[#D4A843]/10 border border-[#D4A843]/30 text-[#D4A843]">
      <Info className="w-5 h-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
      <div>
        <p className="text-sm font-mono font-bold">Booking received</p>
        <p className="text-xs font-mono text-[#D4A843]/80">{PAYMENTS_OFF_MESSAGE}</p>
      </div>
    </div>
  );
}
