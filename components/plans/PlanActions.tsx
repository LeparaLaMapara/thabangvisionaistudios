'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The two things a client can change on a plan: add one of their own open
 * bookings or requests to it, or close it. The server checks everything
 * (app/api/plans/[id]/items, /close); this only sends ids it was given.
 */

const button = 'inline-flex min-h-[44px] items-center justify-center px-4 text-xs font-mono font-bold uppercase tracking-widest transition-opacity hover:opacity-80 disabled:opacity-50';

export function AddToPlan({ planId, parts }: { planId: string; parts: { kind: string; refId: string; line: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!parts.length) return null;

  async function add(kind: string, refId: string): Promise<void> {
    setBusy(refId);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(planId)}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, ref_id: refId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not add it.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add it.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="add-to-plan" className="mt-10 border-t border-white/10 pt-6">
      <h2 id="add-to-plan" className="text-sm font-mono uppercase tracking-widest text-neutral-400">Add to this plan</h2>
      <p className="mt-1 text-sm text-neutral-500">Your open requests and gear orders that are not in a plan yet.</p>
      <ul className="mt-4 space-y-2">
        {parts.map((p) => (
          <li key={p.refId} className="flex flex-col gap-2 border border-white/10 p-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-neutral-200">{p.line}</span>
            <button type="button" onClick={() => add(p.kind, p.refId)} disabled={busy !== null} className={`${button} border border-[#D4A843]/50 text-[#D4A843]`}>
              {busy === p.refId ? 'Adding…' : 'Add'}
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    </section>
  );
}

export function ClosePlan({ planId }: { planId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function close(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(planId)}/close`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not close the plan.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close the plan.');
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={`${button} border border-white/15 text-neutral-400`}>
        Close this plan
      </button>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-neutral-400">Closing the plan does not cancel anything in it. Your requests and bookings stay as they are.</p>
      <div className="flex gap-2">
        <button type="button" onClick={close} disabled={busy} className={`${button} bg-[#D4A843] text-black`}>
          {busy ? 'Closing…' : 'Close it'}
        </button>
        <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={`${button} border border-white/15 text-neutral-300`}>
          Keep it open
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    </div>
  );
}
