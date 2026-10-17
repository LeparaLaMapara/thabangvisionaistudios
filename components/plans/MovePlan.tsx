'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/**
 * "Move my shoot" on the plan page. Pick a new date, see what happens to
 * each part (read live by the server), then move the plan itself. Moving
 * changes only the plan's date and the do by dates; bookings and requests
 * are changed only by the client or our team (app/api/plans/[id]/move).
 */

const button = 'inline-flex min-h-[44px] items-center justify-center px-4 text-xs font-mono font-bold uppercase tracking-widest transition-opacity hover:opacity-80 disabled:opacity-50';

interface Advice {
  line: string;
  what: string;
  action: { label: string; href: string } | null;
}

const isOwnPath = (v: string): boolean => v.startsWith('/') && !v.startsWith('//');
const isWhatsapp = (v: string): boolean => v.startsWith('https://wa.me/');

export function MovePlan({ planId, minDate }: { planId: string; minDate: string }) {
  const router = useRouter();
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState<'check' | 'move' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<{ to: string; parts: Advice[]; canMove: boolean } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function runCheck(): Promise<void> {
    if (!date) return;
    setBusy('check');
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(planId)}/move?date=${encodeURIComponent(date)}`, { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as { error?: string; to?: string; parts?: Advice[]; can_move?: boolean };
      if (!res.ok) throw new Error(body.error ?? 'Could not check that date.');
      setCheck({ to: body.to ?? date, parts: Array.isArray(body.parts) ? body.parts : [], canMove: body.can_move === true });
    } catch (err) {
      setCheck(null);
      setError(err instanceof Error ? err.message : 'Could not check that date.');
    } finally {
      setBusy(null);
    }
  }

  async function move(): Promise<void> {
    setBusy('move');
    setError(null);
    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(planId)}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not move the plan.');
      setDone(`Your plan is moved to ${check?.to ?? date}. Bookings and requests are not changed.`);
      setCheck(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move the plan.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="move-plan" className="mt-10 border-t border-white/10 pt-6">
      <h2 id="move-plan" className="text-sm font-mono uppercase tracking-widest text-neutral-400">Move my shoot</h2>
      <p className="mt-1 text-sm text-neutral-500">See what happens to each part on a new date. Nothing changes until you press Move.</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 text-xs font-mono uppercase tracking-widest text-neutral-400">
          New date
          <input
            type="date"
            min={minDate}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setCheck(null);
            }}
            className="min-h-[44px] border border-white/15 bg-black/40 px-3 text-sm text-neutral-100"
          />
        </label>
        <button type="button" onClick={runCheck} disabled={!date || busy !== null} className={`${button} border border-[#D4A843]/50 text-[#D4A843]`}>
          {busy === 'check' ? 'Checking…' : 'Check this date'}
        </button>
      </div>
      {check && (
        <div className="mt-5 space-y-3">
          <p className="text-sm text-neutral-200">On {check.to}:</p>
          <ul className="space-y-2">
            {check.parts.map((p, i) => (
              <li key={`${p.line}-${i}`} className="border border-white/10 p-3 text-sm">
                <p className="text-neutral-200">{p.line}</p>
                <p className="mt-1 text-neutral-400">{p.what}</p>
                {p.action && isWhatsapp(p.action.href) && (
                  <a href={p.action.href} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-[44px] items-center text-sm text-[#D4A843] underline underline-offset-2">
                    {p.action.label}
                  </a>
                )}
                {p.action && isOwnPath(p.action.href) && (
                  <Link href={p.action.href} className="mt-2 inline-flex min-h-[44px] items-center text-sm text-[#D4A843] underline underline-offset-2">
                    {p.action.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {check.canMove && (
            <button type="button" onClick={move} disabled={busy !== null} className={`${button} bg-[#D4A843] text-[#050505]`}>
              {busy === 'move' ? 'Moving…' : `Move the plan to ${check.to}`}
            </button>
          )}
        </div>
      )}
      {done && <p role="status" className="mt-3 text-sm text-emerald-300">{done}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    </section>
  );
}
