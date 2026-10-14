'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

/** Ask to book: date, arrival time, how long, area (address optional). No payment. */
export function RequestForm({ personRoleId, defaultArea }: { personRoleId: string; defaultArea: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = 'w-full min-h-[48px] px-3 bg-black/40 border border-white/15 text-white focus:border-accent-gold outline-none';

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
          date: f.get('date'),
          arrival: f.get('arrival'),
          hours: Number(f.get('hours')),
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
      <label className="block">
        <span className="block text-sm text-neutral-300 mb-1">Date</span>
        <input name="date" type="date" required className={field} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm text-neutral-300 mb-1">Arrival time</span>
          <input name="arrival" type="time" required defaultValue="08:00" className={field} />
        </label>
        <label className="block">
          <span className="block text-sm text-neutral-300 mb-1">How long (hours)</span>
          <input name="hours" type="number" min={0.5} max={24} step={0.5} required defaultValue={4} className={field} />
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
        <textarea name="note" maxLength={500} className={`${field} min-h-[80px] py-2`} />
      </label>
      {error && <p className="text-sm text-red-300" role="alert">{error}</p>}
      <button type="submit" disabled={busy} className="w-full min-h-[52px] bg-accent-gold text-black text-sm font-mono font-bold uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50">
        {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Send request
      </button>
      <p className="text-xs text-neutral-500">No payment now. We confirm the booking and the price with you first.</p>
    </form>
  );
}
