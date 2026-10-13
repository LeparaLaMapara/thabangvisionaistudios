'use client';

import { useSearchParams } from 'next/navigation';
import { servicePaymentNotice } from '@/lib/bookings/service-payment-notice';

/**
 * What happened to a service booking payment, shown once on the way back
 * from Paystack (/api/service-bookings/callback or the cancel link). Renders
 * nothing without a ?status= the callback sets.
 */
export function ServicePaymentNotice() {
  const params = useSearchParams();
  const notice = servicePaymentNotice(params.get('status'), params.get('ref'));
  if (!notice) return null;
  const tone = notice.tone === 'good'
    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
    : notice.tone === 'bad'
      ? 'border-red-500/30 bg-red-500/5 text-red-300'
      : 'border-yellow-500/30 bg-yellow-500/5 text-yellow-200';
  return (
    <div role={notice.tone === 'bad' ? 'alert' : 'status'} className={`mb-6 rounded-lg border p-4 text-sm ${tone}`}>
      <p className="font-medium">{notice.title}</p>
      <p className="mt-1 text-neutral-300">{notice.body}</p>
    </div>
  );
}
