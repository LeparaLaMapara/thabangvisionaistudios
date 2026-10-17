'use client';

import type { OutlineCardData } from '@/lib/ubunye/outline-card';

/**
 * "Your shoot": the plan_outline result as one calm card. The shoot, when
 * and where, then one row per part with a status dot (gold: we have it,
 * grey: coming soon, not offered or nobody listed) and one short line built
 * only from the tool's fields (lib/ubunye/outline-card.ts).
 */
export function ShootOutlineCard({ card }: { card: OutlineCardData }) {
  return (
    <section aria-label="Your shoot" className="mt-3 rounded-2xl border border-white/10 bg-[#0b0b0b] px-5 py-5">
      <p className="font-mono text-[11px] uppercase tracking-wider text-neutral-400">Your shoot</p>
      <h3 className="mt-1 font-display text-lg text-neutral-100">{card.title}</h3>
      {card.when && <p className="text-sm text-neutral-400">{card.when}</p>}

      <ul className="mt-4">
        {card.rows.map((row) => (
          <li key={row.key} className="flex items-start gap-3 min-h-[44px] py-2">
            <span
              aria-hidden="true"
              className={`mt-[7px] w-2 h-2 shrink-0 rounded-full ${row.dot === 'gold' ? 'bg-[#D4A843]' : 'bg-neutral-600'}`}
            />
            <div className="min-w-0">
              <p className="text-[15px] leading-snug text-neutral-200">{row.label}</p>
              <p className="text-[13px] leading-snug text-neutral-400">{row.note}</p>
            </div>
          </li>
        ))}
      </ul>

      {card.warning && <p className="mt-3 text-[13px] leading-snug text-amber-200/80">{card.warning}</p>}
    </section>
  );
}
