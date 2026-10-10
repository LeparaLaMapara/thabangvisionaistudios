'use client';

import { useEffect, useState } from 'react';
import { formatRand } from '@/lib/format/money';
import type { OwnerHireView } from '@/lib/rental/owner-earnings';

const day = (ymd: string): string =>
  new Date(`${ymd.slice(0, 10)}T12:00:00+02:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });

/**
 * Hires of the owner's gear and what each pays them (GET /api/listings/earnings).
 * Shown only once there is something to show; a failed load says so.
 */
export function OwnerHires() {
  const [hires, setHires] = useState<OwnerHireView[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch('/api/listings/earnings')
      .then(async (r) => {
        if (!r.ok) throw new Error('load failed');
        return (await r.json()) as { hires: OwnerHireView[] };
      })
      .then((d) => setHires(d.hires))
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return <p className="mb-8 text-xs font-mono text-neutral-400">We could not load the hires of your gear just now. Reload the page to try again.</p>;
  }
  if (!hires || hires.length === 0) return null;

  return (
    <section aria-labelledby="owner-hires" className="mb-10">
      <h3 id="owner-hires" className="text-sm font-bold uppercase tracking-tight mb-1 border-l-2 border-[#D4A843] pl-4 text-white">
        Hires and earnings
      </h3>
      <p className="text-xs font-mono text-neutral-400 mb-4 pl-4">
        Your share is paid after a clean return, once a person on our team has approved the payout. Renters&apos; details stay private.
      </p>
      <ul className="divide-y divide-white/5 border border-white/10">
        {hires.map((h) => (
          <li key={h.id} className="p-4 space-y-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-mono text-white">
                {h.title} <span className="text-neutral-400">· {day(h.startDate)} to {day(h.endDate)}</span>
              </p>
              {h.shareCents !== null && (
                <p className="text-sm font-mono text-white">
                  <span className="text-xs text-neutral-400">Your share </span>
                  {formatRand(h.shareCents / 100, { decimals: h.shareCents % 100 !== 0 })}
                </p>
              )}
            </div>
            <p className="text-xs font-mono text-neutral-400">{h.stage}</p>
            {h.payout && (
              <p className={`text-xs font-mono ${h.payout.tone === 'done' ? 'text-emerald-400' : h.payout.tone === 'attention' ? 'text-[#D4A843]' : 'text-neutral-300'}`}>
                {h.payout.text}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
