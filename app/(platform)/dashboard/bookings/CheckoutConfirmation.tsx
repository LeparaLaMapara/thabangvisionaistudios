'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Clock } from 'lucide-react';
import { STUDIO } from '@/lib/constants';
import { collectionPoint } from '@/lib/rental/collection-point';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The fields of an order line this banner reads (GET /api/bookings returns the whole row). */
export interface OrderLineView {
  id: string;
  status: string;
  checkout_group_id?: string | null;
  fulfilment_method?: string | null;
  requires_manual_approval?: boolean | null;
}

/**
 * Shown on My Rentals after the checkout (?checkout=<order>), and after the
 * payment page sends the customer back (&payment=success): whether the
 * payment is confirmed yet, and what happens next. The booking itself is only
 * confirmed by the payment provider's verified notice, never by this page.
 */
export function CheckoutConfirmation({
  bookings,
  onOrder,
  onRefresh,
}: {
  bookings: OrderLineView[];
  /** Called once when the page was opened for an order (to show the gear tab). */
  onOrder: () => void;
  /** Reload the bookings, while the payment is being confirmed. */
  onRefresh: () => void;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const [waitedLong, setWaitedLong] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [releaseNote, setReleaseNote] = useState<string | null>(null);
  const order = params.get('checkout');
  const paid = params.get('payment') === 'success';
  const valid = !!order && UUID.test(order);
  const lines = valid ? bookings.filter((b) => b.checkout_group_id === order) : [];
  const confirmed = lines.length > 0 && lines.every((b) => !['pending', 'cancelled'].includes(b.status));
  const delivery = lines.some((b) => b.fulfilment_method === 'delivery');
  const manual = lines.some((b) => b.requires_manual_approval === true);

  const told = useRef(false);
  useEffect(() => {
    if (valid && !told.current) {
      told.current = true;
      onOrder();
    }
  }, [valid, onOrder]);

  // While the provider's notice is on its way, look again a few times.
  const tries = useRef(0);
  useEffect(() => {
    if (!valid || !paid || confirmed) return;
    const timer = setInterval(() => {
      tries.current += 1;
      if (tries.current > 6) {
        clearInterval(timer);
        setWaitedLong(true);
        return;
      }
      onRefresh();
    }, 5_000);
    return () => clearInterval(timer);
  }, [valid, paid, confirmed, onRefresh]);

  if (!valid) return null;

  // The payment page also sends people here when they cancel. If nothing is
  // confirmed after a while, let them release the dates and go back to the
  // cart (POST /api/cart/cancel refuses a paid order; a late payment is
  // still handled by the payment pipeline).
  const releaseAndReturn = async () => {
    setReleasing(true);
    setReleaseNote(null);
    try {
      const res = await fetch('/api/cart/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkout_group_id: order }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.released) {
        router.push('/dashboard/cart');
        return;
      }
      if (data.code === 'ALREADY_PAID') {
        onRefresh();
        setReleaseNote('This order is paid. It shows as confirmed in a moment.');
      } else if (data.code === 'HOLD_KEPT') {
        setReleaseNote('Open the booking below to cancel it before booking again.');
      } else {
        setReleaseNote('Could not release the dates just now. Please try again.');
      }
    } catch {
      setReleaseNote('Could not release the dates just now. Please try again.');
    }
    setReleasing(false);
  };

  return (
    <section
      role="status"
      aria-live="polite"
      aria-label="Your order"
      className={`p-4 mb-6 border space-y-3 ${confirmed ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-[#D4A843]/30 bg-[#D4A843]/5'}`}
    >
      <div className="flex items-start gap-3">
        {confirmed ? (
          <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-400" aria-hidden="true" />
        ) : (
          <Clock className="w-5 h-5 flex-shrink-0 text-[#D4A843]" aria-hidden="true" />
        )}
        <div className="space-y-1">
          <p className="text-sm font-mono font-bold text-white">
            {confirmed
              ? 'Payment confirmed. Your booking is confirmed.'
              : paid
                ? 'Thank you. We are confirming your payment.'
                : 'Your order is placed.'}
          </p>
          {!confirmed && paid && (
            <p className="text-xs font-mono text-neutral-400">
              The payment provider confirms it to us, usually within a few minutes, and this page updates. Please do not pay again.
            </p>
          )}
          {!confirmed && paid && waitedLong && (
            <div className="space-y-1">
              <p className="text-xs font-mono text-neutral-400">
                Still not confirmed. If you cancelled on the payment page, nothing was charged: release these dates and go back to your cart.
              </p>
              <button
                type="button"
                onClick={() => void releaseAndReturn()}
                disabled={releasing}
                className="min-h-[44px] text-xs font-mono uppercase tracking-widest text-[#D4A843] underline underline-offset-4 disabled:opacity-50"
              >
                {releasing ? 'Releasing…' : 'I cancelled: back to my cart'}
              </button>
              {releaseNote && <p className="text-xs font-mono text-neutral-400">{releaseNote}</p>}
            </div>
          )}
        </div>
      </div>
      <div>
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-1">What happens next</p>
        <ul className="list-disc pl-5 space-y-1 text-xs font-mono text-neutral-300">
          {delivery ? (
            <li>We contact you to arrange the delivery time. Have the ID you verified with ready when it arrives.</li>
          ) : (
            <li>
              You get a message with the collection details. Collect at {collectionPoint()}, {STUDIO.location.city} ({STUDIO.hours.weekday}, {STUDIO.hours.weekend}) and bring the ID you verified with.
            </li>
          )}
          {manual && <li>A person approves this booking before the gear is handed over. We let you know if we need anything.</li>}
          <li>Your booking is below under Equipment Rentals, with its details and how to cancel.</li>
        </ul>
      </div>
    </section>
  );
}
