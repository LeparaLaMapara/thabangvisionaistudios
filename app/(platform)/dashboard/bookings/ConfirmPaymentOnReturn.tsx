'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Waits before asking again after an inconclusive check (then the daily recovery pass takes over). */
const RETRY_DELAYS_MS = [4_000, 10_000, 30_000];

/**
 * Back from the payment page (?checkout=<order>&payment=success): ask the
 * server to check the charge with the payment provider
 * (POST /api/cart/confirm), then re-read the bookings. A lost or slow webhook
 * then no longer leaves a paid order "being confirmed" until the daily
 * recovery pass. The server confirms only what the provider reports; nothing
 * this page sends counts as proof of payment. Renders nothing.
 */
export function ConfirmPaymentOnReturn({ onConfirmed }: { onConfirmed: () => void }) {
  const params = useSearchParams();
  const order = params.get('checkout');
  const returned = params.get('payment') === 'success' && !!order && UUID.test(order);
  const asked = useRef(false);

  useEffect(() => {
    if (!returned || asked.current) return;
    asked.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // An inconclusive answer (still pending, provider unreachable, 5xx) is
    // asked again a few times, so a lost webhook plus one slow check does not
    // leave the order waiting for the daily recovery pass.
    const ask = (attempt: number) => {
      fetch('/api/cart/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkout_group_id: order }),
      })
        .then((r) => (r.ok || r.status >= 500 ? r.json().catch(() => null) : null))
        .catch(() => null)
        .then((d: { state?: string } | null) => {
          if (stopped) return;
          // Paid, or taken but held for a person: either way the bookings changed.
          if (d?.state === 'paid' || d?.state === 'held') return onConfirmed();
          const inconclusive = !d || d.state === 'pending' || d.state === 'unknown';
          if (inconclusive && attempt < RETRY_DELAYS_MS.length) {
            timer = setTimeout(() => ask(attempt + 1), RETRY_DELAYS_MS[attempt]);
          }
        });
    };
    ask(0);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [returned, order, onConfirmed]);

  return null;
}
