import { Info } from 'lucide-react';
import { PAYMENTS_NOT_OPEN_NOTICE } from '@/lib/payments/offline-message';

/**
 * The "online card payment is not open yet" line, shown where a customer
 * commits. Renders nothing when `open` is true (payments are live) or null
 * (not known yet), so it switches off by itself when payments open.
 * `open` comes from onlinePaymentsOpen() on the server, or usePaymentsOpen().
 */
export function PaymentsNotOpenNote({ open, className = '' }: { open: boolean | null; className?: string }) {
  if (open !== false) return null;
  return (
    <p role="note" className={`flex items-start gap-2 text-xs font-mono text-[#D4A843]/90 leading-relaxed ${className}`}>
      <Info className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
      <span>{PAYMENTS_NOT_OPEN_NOTICE}</span>
    </p>
  );
}
