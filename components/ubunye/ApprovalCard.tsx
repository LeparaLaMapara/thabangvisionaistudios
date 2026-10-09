'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * The human approval screen for a Ubunye proposal (spec §8.7). It loads the
 * proposal from the server (never from the chat text), shows exactly what
 * would be booked and paid, and only a press of Approve here commits it. The
 * single-use approval token is fetched by this component and sent straight
 * back to the server; the AI never sees it.
 */

interface Summary {
  title: string;
  period: string;
  lines: { label: string; amountCents: number }[];
  depositCents: number;
  totalCents: number;
  collection: string | null;
  cancellationPolicy: string;
  nextStep: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; summary: Summary; token: string; expiresAt: string }
  | { kind: 'working'; summary: Summary }
  | { kind: 'done'; message: string; next: string | null }
  | { kind: 'declined' }
  | { kind: 'closed'; message: string };

const rands = (cents: number): string =>
  `R${(cents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ApprovalCard({ proposalId }: { proposalId: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/agent-actions/${encodeURIComponent(proposalId)}`, { cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setState({ kind: 'closed', message: body.error ?? 'This proposal is no longer waiting for approval.' });
          return;
        }
        setState({ kind: 'ready', summary: body.summary as Summary, token: body.token as string, expiresAt: body.expires_at as string });
      } catch {
        if (!cancelled) setState({ kind: 'closed', message: 'Could not load this proposal. Ask Ubunye again.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [proposalId]);

  async function approve(): Promise<void> {
    if (state.kind !== 'ready') return;
    const { summary, token } = state;
    setState({ kind: 'working', summary });
    try {
      const res = await fetch(`/api/agent-actions/${encodeURIComponent(proposalId)}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, approved: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ kind: 'closed', message: body.error ?? 'This could not be completed. Nothing was charged.' });
        return;
      }
      setState({ kind: 'done', message: body.message ?? 'Done.', next: typeof body.next === 'string' && body.next.startsWith('/') ? body.next : null });
    } catch {
      setState({ kind: 'closed', message: 'Something went wrong. Nothing was charged; ask Ubunye again.' });
    }
  }

  async function decline(): Promise<void> {
    setState({ kind: 'declined' });
    await fetch(`/api/agent-actions/${encodeURIComponent(proposalId)}`, { method: 'DELETE' }).catch(() => undefined);
  }

  const box = 'mt-3 rounded-lg border border-[#D4A843]/30 bg-[#0b0b0b] p-4 text-[14px] text-neutral-300';

  if (state.kind === 'loading') return <div className={box}><span className="font-mono text-xs text-neutral-500">Loading the proposal…</span></div>;
  if (state.kind === 'closed') return <div className={box}><p className="text-neutral-400">{state.message}</p></div>;
  if (state.kind === 'declined') return <div className={box}><p className="text-neutral-400">Declined. Nothing was booked or charged.</p></div>;
  if (state.kind === 'done') {
    return (
      <div className={box}>
        <p className="text-neutral-200">{state.message}</p>
        {state.next && (
          <Link href={state.next} className="mt-3 inline-flex min-h-[44px] items-center rounded-md bg-[#D4A843] px-4 font-medium text-[#050505]">
            Continue
          </Link>
        )}
      </div>
    );
  }

  const s = state.summary;
  return (
    <div className={box} role="group" aria-label="Approve this booking">
      <p className="font-mono text-[11px] uppercase tracking-wider text-[#D4A843]">Approval needed</p>
      <p className="mt-1 font-display text-lg text-neutral-100">{s.title}</p>
      <p className="text-neutral-400">{s.period}</p>
      <dl className="mt-3 space-y-1 font-mono text-[13px]">
        {s.lines.map((l) => (
          <div key={l.label} className="flex justify-between"><dt>{l.label}</dt><dd>{rands(l.amountCents)}</dd></div>
        ))}
        {s.depositCents > 0 && (
          <div className="flex justify-between"><dt>Refundable deposit</dt><dd>{rands(s.depositCents)}</dd></div>
        )}
        <div className="flex justify-between border-t border-neutral-800 pt-1 text-neutral-100"><dt>Total</dt><dd>{rands(s.totalCents)}</dd></div>
      </dl>
      {s.collection && <p className="mt-3 text-neutral-300">{s.collection}</p>}
      <p className="mt-3 text-[12px] text-neutral-500">{s.cancellationPolicy}</p>
      <p className="mt-2 text-[12px] text-neutral-400">{s.nextStep}</p>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={approve}
          disabled={state.kind === 'working'}
          className="min-h-[44px] flex-1 rounded-md bg-[#D4A843] px-4 font-medium text-[#050505] disabled:opacity-60"
        >
          {state.kind === 'working' ? 'Working…' : 'Approve'}
        </button>
        <button
          type="button"
          onClick={decline}
          disabled={state.kind === 'working'}
          className="min-h-[44px] rounded-md border border-neutral-700 px-4 text-neutral-300 disabled:opacity-60"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
