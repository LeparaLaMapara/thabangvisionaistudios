'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, Clapperboard } from 'lucide-react';
import type { Movement } from '@/lib/admin/control-room/today';

const KIND = {
  out: { label: 'Going out', Icon: ArrowUpRight, tint: 'text-sky-300' },
  back: { label: 'Coming back', Icon: ArrowDownLeft, tint: 'text-emerald-300' },
  shoot: { label: 'Shoot', Icon: Clapperboard, tint: 'text-accent-gold' },
} as const;

/** Like a departures board: what leaves, what comes back, which shoots happen. */
export function MovementsBoard({ items }: { items: Movement[] }) {
  const [day, setDay] = useState<'today' | 'tomorrow'>('today');
  const list = items.filter((m) => m.day === day);
  const counts = { today: items.filter((m) => m.day === 'today').length, tomorrow: items.filter((m) => m.day === 'tomorrow').length };

  return (
    <section aria-labelledby="movements-h" className="rounded-2xl border border-white/10 bg-white/[0.02]">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <h2 id="movements-h" className="font-display text-lg text-white">On the move</h2>
        <div className="flex rounded-full border border-white/10 p-0.5" role="group" aria-label="Day">
          {(['today', 'tomorrow'] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={day === d}
              onClick={() => setDay(d)}
              className={`min-h-[34px] rounded-full px-3 text-sm capitalize ${day === d ? 'bg-white/10 text-white' : 'text-neutral-400'}`}
            >
              {d} <span className="tabular-nums text-neutral-500">{counts[d]}</span>
            </button>
          ))}
        </div>
      </div>
      {list.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-neutral-400">
          Nothing goes out or comes back {day}.
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {list.map((m) => {
            const k = KIND[m.kind];
            return (
              <li key={m.id}>
                <Link href={m.href} className="flex min-h-[56px] items-center gap-3 px-4 py-3 hover:bg-white/[0.03]">
                  <k.Icon className={`h-5 w-5 flex-shrink-0 ${k.tint}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] text-white">{m.what}</span>
                    <span className="block truncate text-xs text-neutral-400">
                      {k.label} · {m.who} · {m.how}
                    </span>
                  </span>
                  {m.late && (
                    <span className="flex-shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-300">Late</span>
                  )}
                  {m.warn && (
                    <span className="flex-shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-200">{m.warn}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
