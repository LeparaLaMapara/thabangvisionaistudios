'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, X } from 'lucide-react';
import { bookingTotal, formatRands, pricedByDays, REQUEST_NEXT_STEPS, type PricingUnit } from '@/lib/roles';

/**
 * Ask to book, like Rentals: pick the day or days (or the hours, for an
 * hourly person) and see the one total before sending. Nothing is paid here:
 * what happens next is spelled out under the button (lib/roles/request-loop.ts).
 */
export function RequestForm({
  personRoleId,
  defaultArea,
  defaultDates = [],
  defaultNote = '',
  minDate,
  unit,
  priceCents,
}: {
  personRoleId: string;
  defaultArea: string;
  /** Checked prefill (lib/roles/request-prefill.ts), e.g. from Ubunye. */
  defaultDates?: string[];
  defaultNote?: string;
  /** South African today: earlier days cannot be picked. */
  minDate?: string;
  unit: PricingUnit;
  priceCents: number;
}) {
  const router = useRouter();
  const byDays = pricedByDays(unit);
  const [dates, setDates] = useState<string[]>(defaultDates.length ? defaultDates : ['']);
  const [hours, setHours] = useState(byDays ? 8 : 4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = 'w-full min-h-[48px] px-3 bg-black/40 border border-white/15 text-white focus:border-accent-gold outline-none';

  const picked = dates.filter(Boolean);
  const total = useMemo(() => bookingTotal(unit, priceCents, { days: Math.max(1, picked.length), hours }), [unit, priceCents, picked.length, hours]);

  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/roles/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          person_role_id: personRoleId,
          dates: picked,
          arrival: f.get('arrival'),
          hours,
          area: f.get('area'),
          address: f.get('address') || null,
          note: f.get('note') || null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !body.id) throw new Error(body.error ?? 'Could not send the request.');
      router.push(`/people/requests/${body.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the request.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="block text-sm text-neutral-300 mb-1">{byDays ? 'Day or days' : 'Date'}</legend>
        {dates.map((d, i) => (
          <div key={i} className="flex gap-2">
            <input
              type="date"
              required={i === 0}
              value={d}
              min={minDate}
              aria-label={`Day ${i + 1}`}
              onChange={(e) => setDates((x) => x.map((y, j) => (j === i ? e.target.value : y)))}
              className={field}
            />
            {i > 0 && (
              <button type="button" aria-label="Remove this day" onClick={() => setDates((x) => x.filter((_, j) => j !== i))} className="min-w-[48px] min-h-[48px] border border-white/15 flex items-center justify-center">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        {byDays && dates.length < 14 && (
          <button type="button" onClick={() => setDates((x) => [...x, ''])} className="min-h-[44px] px-3 border border-white/15 text-sm text-neutral-200 flex items-center gap-2">
            <Plus className="w-4 h-4" aria-hidden="true" /> Add another day
          </button>
        )}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm text-neutral-300 mb-1">Arrival time</span>
          <input name="arrival" type="time" required defaultValue="08:00" className={field} />
        </label>
        <label className="block">
          <span className="block text-sm text-neutral-300 mb-1">{byDays ? 'Hours each day' : 'How long (hours)'}</span>
          <input type="number" min={0.5} max={24} step={0.5} required value={hours} onChange={(e) => setHours(Number(e.target.value) || 1)} className={field} />
        </label>
      </div>
      <label className="block">
        <span className="block text-sm text-neutral-300 mb-1">Area</span>
        <input name="area" required maxLength={80} defaultValue={defaultArea} className={field} />
      </label>
      <label className="block">
        <span className="block text-sm text-neutral-300 mb-1">Exact address (optional)</span>
        <input name="address" maxLength={200} className={field} />
        <span className="block text-xs text-neutral-500 mt-1">Shared with them only after the booking is confirmed.</span>
      </label>
      <label className="block">
        <span className="block text-sm text-neutral-300 mb-1">Anything they should know (optional)</span>
        <textarea name="note" maxLength={500} defaultValue={defaultNote} className={`${field} min-h-[80px] py-2`} />
      </label>

      <div className="border border-accent-gold/40 bg-accent-gold/5 p-4" aria-live="polite">
        <p className="text-xs text-neutral-400">{total.label}</p>
        <p className="text-2xl text-white font-display">Total {formatRands(total.totalCents)}</p>
        <p className="text-xs text-neutral-500 mt-1">{unit === 'day_plus_km' ? 'Plus the kilometres, shown when the trip is known.' : 'One price. Nothing more is added.'}</p>
      </div>

      {error && <p className="text-sm text-red-300" role="alert">{error}</p>}
      <button type="submit" disabled={busy} className="w-full min-h-[52px] bg-accent-gold text-black text-sm font-mono font-bold uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50">
        {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Send request
      </button>
      <div className="text-xs text-neutral-400 space-y-1">
        <p className="text-neutral-300">What happens next</p>
        <ol className="list-decimal pl-4 space-y-1">
          {REQUEST_NEXT_STEPS.map((s) => <li key={s}>{s}</li>)}
        </ol>
      </div>
    </form>
  );
}
