'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Back from the payment page (?checkout=<order>&payment=success): ask the
 * server once to check the charge with the payment provider
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
    fetch('/api/cart/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkout_group_id: order }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { state?: string } | null) => {
        // Paid, or taken but held for a person: either way the bookings changed.
        if (d?.state === 'paid' || d?.state === 'held') onConfirmed();
      })
      .catch(() => undefined);
  }, [returned, order, onConfirmed]);

  return null;
}
