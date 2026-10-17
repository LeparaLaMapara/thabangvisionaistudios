'use client';

import { useId } from 'react';
import { MODE_SWITCH_LABEL, modeSegments, type OutlineCardData } from '@/lib/ubunye/outline-card';

/**
 * "Your shoot": the plan_outline result as one calm card. At the top, when
 * the tool gives a mode, "Who's shooting?": tapping another answer sends it
 * as the client's own message, so Ubunye re-plans. Then the shoot, when and
 * where, one row per part with a status dot (gold: we have it, grey: coming
 * soon, not offered or nobody listed) and one short line built only from the
 * tool's fields (lib/ubunye/outline-card.ts). Event extras are quieter and
 * say "Optional". The estimate, when given, is the last line, word for word.
 */
export function ShootOutlineCard({
  card,
  onSend,
  busy = false,
}: {
  card: OutlineCardData;
  /** Sends a message as the client (the chat page's own send path). Without it, no switch. */
  onSend?: (text: string) => void;
  /** A reply is streaming: the switch waits. */
  busy?: boolean;
}) {
  const segments = onSend ? modeSegments(card) : [];
  const labelId = useId();

  return (
    <section aria-label="Your shoot" className="mt-3 rounded-2xl border border-white/10 bg-[#0b0b0b] px-5 py-5">
      {segments.length > 0 && onSend && (
        <div className="mb-5">
          <p id={labelId} className="font-mono text-[11px] uppercase tracking-wider text-neutral-400">
            {MODE_SWITCH_LABEL}
          </p>
          <div
            role="group"
            aria-labelledby={labelId}
            className={`mt-2 grid gap-1 rounded-xl border border-white/10 p-1 ${segments.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}
          >
            {segments.map((s) => {
              const selected = s.mode === card.mode;
              return (
                <button
                  key={s.mode}
                  type="button"
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={() => {
                    if (!selected && !busy) onSend(s.message);
                  }}
                  className={`min-h-[44px] rounded-lg px-2 py-2 text-[13px] leading-tight transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4A843] disabled:cursor-not-allowed ${
                    selected
                      ? 'bg-[#D4A843]/15 text-[#D4A843]'
                      : 'text-neutral-300 hover:text-neutral-100 disabled:opacity-50'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p className="font-mono text-[11px] uppercase tracking-wider text-neutral-400">Your shoot</p>
      <h3 className="mt-1 font-display text-lg text-neutral-100">{card.title}</h3>
      {card.when && <p className="text-sm text-neutral-400">{card.when}</p>}

      <ul className="mt-4">
        {card.rows.map((row) => (
          <li key={row.key} data-optional={row.optional || undefined} className="flex items-start gap-3 min-h-[44px] py-2">
            <span
              aria-hidden="true"
              className={`mt-[7px] w-2 h-2 shrink-0 rounded-full ${
                row.optional
                  ? `border ${row.dot === 'gold' ? 'border-[#D4A843]/70' : 'border-neutral-600'}`
                  : row.dot === 'gold' ? 'bg-[#D4A843]' : 'bg-neutral-600'
              }`}
            />
            <div className="min-w-0">
              <p className={`text-[15px] leading-snug ${row.optional ? 'text-neutral-400' : 'text-neutral-200'}`}>{row.label}</p>
              <p className="text-[13px] leading-snug text-neutral-400">{row.note}</p>
            </div>
          </li>
        ))}
      </ul>

      {card.warning && <p className="mt-3 text-[13px] leading-snug text-amber-200/80">{card.warning}</p>}

      {card.estimate && <p className="mt-3 text-[13px] leading-snug text-neutral-400">{card.estimate}</p>}
    </section>
  );
}
