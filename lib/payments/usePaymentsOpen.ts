'use client';

import { useEffect, useState } from 'react';

/**
 * Client side view of onlinePaymentsOpen(). Pass the server's answer as
 * `initial` when the page has it; otherwise it asks /api/payments/status once.
 * Until the answer arrives it returns null, so callers can hold back wording
 * rather than promise either way.
 */
export function usePaymentsOpen(initial?: boolean): boolean | null {
  const [open, setOpen] = useState<boolean | null>(initial ?? null);
  useEffect(() => {
    if (initial !== undefined) return;
    let live = true;
    fetch('/api/payments/status')
      .then((r) => (r.ok ? r.json() : { open: false }))
      .then((d: { open?: boolean }) => { if (live) setOpen(d.open === true); })
      .catch(() => { if (live) setOpen(false); });
    return () => { live = false; };
  }, [initial]);
  return open;
}
