'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Clock, RotateCw } from 'lucide-react';
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
  const [waitedLong, setWaitedLong] = useState(false);
  // Bumped by "Check again" to start another round of looking.
  const [round, setRound] = useState(0);
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
  }, [valid, paid, confirmed, onRefresh, round]);

  if (!valid) return null;

  // This page is where the payment provider sends people who PAID. It never
  // offers to release the dates: a customer who paid could lose a paid
  // booking, or pay twice. Releasing belongs to the payment=cancelled return
  // (the cart). Here a slow confirmation only gets "check again".
  const checkAgain = () => {
    tries.current = 0;
    setWaitedLong(false);
    onRefresh();
    setRound((r) => r + 1);
  };
  const bookingHref = lines[0] ? `/dashboard/bookings/${lines[0].id}` : '/dashboard/bookings';

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
                Your payment is still being confirmed. Your dates stay held while it is, and the booking shows as confirmed as soon as the payment provider tells us.
              </p>
              <div className="flex flex-wrap items-center gap-x-4">
                <button
                  type="button"
                  onClick={checkAgain}
                  className="min-h-[44px] inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-[#D4A843] underline underline-offset-4"
                >
                  <RotateCw className="w-3 h-3" aria-hidden="true" /> Check again
                </button>
                <Link
                  href={bookingHref}
                  className="min-h-[44px] inline-flex items-center text-xs font-mono uppercase tracking-widest text-[#D4A843] underline underline-offset-4"
                >
                  See your booking
                </Link>
              </div>
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
