'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import type { NeedItem, Urgency } from '@/lib/admin/control-room/today';
import { ADMIN_SECTIONS, type SectionId } from '@/lib/admin/control-room/sections';

const URGENCY: Record<Urgency, { label: string; dot: string }> = {
  now: { label: 'Urgent', dot: 'bg-red-500' },
  today: { label: 'Today', dot: 'bg-accent-gold' },
  soon: { label: 'When you can', dot: 'bg-neutral-500' },
};

const AREA_LABEL: Record<SectionId, string> = Object.fromEntries(ADMIN_SECTIONS.map((s) => [s.id, s.label])) as Record<SectionId, string>;

/** The "needs you" list: one line per thing, one button each, filter by area. */
export function NeedsList({ items }: { items: NeedItem[] }) {
  const [area, setArea] = useState<SectionId | 'all'>('all');
  const [showAll, setShowAll] = useState(false);

  const areas = useMemo(() => {
    const seen = new Map<SectionId, number>();
    for (const i of items) seen.set(i.area, (seen.get(i.area) ?? 0) + 1);
    return ADMIN_SECTIONS.filter((s) => seen.has(s.id)).map((s) => ({ id: s.id, n: seen.get(s.id)! }));
  }, [items]);

  const shown = items.filter((i) => area === 'all' || i.area === area);
  const visible = showAll ? shown : shown.slice(0, 12);

  if (!items.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-12 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-400" aria-hidden="true" />
        <p className="font-display text-xl text-white">Nothing needs you right now</p>
        <p className="max-w-sm text-sm text-neutral-400">
          When someone books, asks for help, uploads an ID or waits to be paid, it shows up here with one button to sort it.
        </p>
      </div>
    );
  }

  return (
    <div>
      {areas.length > 1 && (
        <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Show only">
          {[{ id: 'all' as const, n: items.length }, ...areas].map((a) => {
            const on = area === a.id;
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={on}
                onClick={() => setArea(a.id)}
                className={`min-h-[36px] flex-shrink-0 rounded-full border px-3 text-sm transition-colors ${
                  on ? 'border-accent-gold bg-accent-gold/10 text-white' : 'border-white/10 text-neutral-400 hover:text-white'
                }`}
              >
                {a.id === 'all' ? 'Everything' : AREA_LABEL[a.id]} <span className="tabular-nums text-neutral-500">{a.n}</span>
              </button>
            );
          })}
        </div>
      )}

      <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
        {visible.map((i) => (
          <li key={i.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex min-w-0 flex-1 gap-3">
              <span className={`mt-2 h-2 w-2 flex-shrink-0 rounded-full ${URGENCY[i.urgency].dot}`} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[15px] font-medium leading-snug text-white">{i.title}</p>
                <p className="mt-0.5 text-sm leading-snug text-neutral-400">{i.detail}</p>
                <p className="mt-1 text-xs text-neutral-500">
                  <span className="sr-only">Urgency: </span>
                  {URGENCY[i.urgency].label}
                  {i.waiting ? ` · ${i.waiting}` : ''} · {AREA_LABEL[i.area]}
                </p>
              </div>
            </div>
            <Link
              href={i.action.href}
              className="inline-flex min-h-[44px] flex-shrink-0 items-center justify-center gap-2 self-start rounded-full bg-foreground px-5 text-sm font-semibold text-background transition-opacity hover:opacity-90 sm:self-center"
            >
              {i.action.label}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>

      {shown.length > visible.length && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 min-h-[44px] w-full rounded-xl border border-white/10 text-sm text-neutral-300 hover:text-white"
        >
          Show {shown.length - visible.length} more
        </button>
      )}
    </div>
  );
}
