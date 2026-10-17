'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

/**
 * The human approval screen for a Ubunye proposal (spec §8.7). It loads the
 * proposal from the server (never from the chat text), shows exactly what
 * would be booked and paid, and only a press of Approve here commits it.
 * Loading is read-only; the single-use approval token is requested only when
 * Approve is pressed and sent straight back to the server, so the AI never
 * sees it and a second card for the same proposal cannot invalidate this one.
 */

interface Summary {
  title: string;
  details?: string[];
  period: string;
  lines: { label: string; amountCents: number }[];
  depositCents: number;
  totalCents: number;
  collection: string | null;
  cancellationPolicy: string;
  nextStep: string;
  /** A plan: nothing is paid or booked, so no money is shown. */
  noCharge?: boolean;
  doneMessage?: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; summary: Summary }
  | { kind: 'working'; summary: Summary }
  | { kind: 'done'; message: string; next: string | null }
  | { kind: 'declined'; plan: boolean }
  | { kind: 'closed'; message: string; next?: string | null };

function closedMessage(state: unknown): string {
  if (state === 'committed' || state === 'committing') return 'This proposal was already approved.';
  if (state === 'cancelled') return 'Declined. Nothing was booked or charged.';
  if (state === 'superseded') return 'Ubunye replaced this with a newer proposal.';
  return 'This proposal is no longer waiting for approval. Ask Ubunye for a fresh quote.';
}

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
        if (body.state !== 'prepared') {
          const summary = body.summary as Summary | undefined;
          const plan = summary?.noCharge === true;
          if (plan && (body.state === 'committed' || body.state === 'committing')) {
            setState({ kind: 'closed', message: typeof summary?.doneMessage === 'string' && summary.doneMessage ? summary.doneMessage : 'This plan is saved.', next: '/dashboard/plans' });
            return;
          }
          setState({ kind: 'closed', message: closedMessage(body.state) });
          return;
        }
        setState({ kind: 'ready', summary: body.summary as Summary });
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
    const { summary } = state;
    setState({ kind: 'working', summary });
    try {
      const issued = await fetch(`/api/agent-actions/${encodeURIComponent(proposalId)}`, { method: 'POST', cache: 'no-store' });
      const grant = await issued.json().catch(() => ({}));
      if (!issued.ok || typeof grant.token !== 'string') {
        setState({ kind: 'closed', message: grant.error ?? 'This proposal is no longer waiting for approval. Nothing was booked.' });
        return;
      }
      const token: string = grant.token;
      const res = await fetch(`/api/agent-actions/${encodeURIComponent(proposalId)}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, approved: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ kind: 'closed', message: body.error ?? 'This could not be completed. Check your cart and bookings before asking again.' });
        return;
      }
      setState({ kind: 'done', message: body.message ?? 'Done.', next: typeof body.next === 'string' && body.next.startsWith('/') ? body.next : null });
    } catch {
      setState({ kind: 'closed', message: 'Something went wrong. Check your cart and bookings before asking Ubunye again.' });
    }
  }

  async function decline(): Promise<void> {
    const plan = (state.kind === 'ready' || state.kind === 'working') && state.summary.noCharge === true;
    setState({ kind: 'declined', plan });
    await fetch(`/api/agent-actions/${encodeURIComponent(proposalId)}`, { method: 'DELETE' }).catch(() => undefined);
  }

  const box = 'mt-3 rounded-2xl border border-white/10 bg-[#0b0b0b] px-5 py-5 text-[14px] text-neutral-300';

  if (state.kind === 'loading') return <div className={box}><span className="font-mono text-xs text-neutral-400">Loading the proposal…</span></div>;
  if (state.kind === 'closed') {
    return (
      <div className={box}>
        <p className="text-neutral-400">{state.message}</p>
        {state.next && (
          <Link href={state.next} className="mt-4 inline-flex min-h-[44px] items-center rounded-full border border-[#D4A843]/50 px-5 text-[#D4A843]">
            See your plans
          </Link>
        )}
      </div>
    );
  }
  if (state.kind === 'declined') {
    return (
      <div className={box}>
        <p className="text-neutral-400">{state.plan ? 'Not saved. Nothing was booked or charged.' : 'Declined. Nothing was booked or charged.'}</p>
      </div>
    );
  }
  if (state.kind === 'done') {
    return (
      <div className={box}>
        <p className="text-neutral-200">{state.message}</p>
        {state.next && (
          <Link href={state.next} className="mt-4 inline-flex min-h-[44px] items-center rounded-full bg-[#D4A843] px-5 font-medium text-[#050505]">
            {state.next.startsWith('/dashboard/plans') ? 'See your plan' : 'Continue'}
          </Link>
        )}
      </div>
    );
  }

  const s = state.summary;
  const working = state.kind === 'working';

  // A plan books nothing and costs nothing: one question, two buttons, and
  // what is in it behind a small disclosure.
  if (s.noCharge) {
    return (
      <div className={box} role="group" aria-label="Save this plan">
        <p className="font-display text-lg text-neutral-100">Save this as your plan?</p>
        {s.period && <p className="mt-0.5 text-neutral-400">{s.period}</p>}
        <p className="mt-3 text-neutral-300">It books nothing and costs nothing.</p>
        {((s.details && s.details.length > 0) || s.title) && (
          <details className="group mt-3">
            <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 text-[13px] text-neutral-400 hover:text-[#D4A843] [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" aria-hidden="true" />
              See what is in it
            </summary>
            <div className="pb-1 pl-5 text-[13px] text-neutral-300">
              {s.title && <p className="text-neutral-200">{s.title}</p>}
              {s.details && s.details.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {s.details.map((d) => <li key={d}>{d}</li>)}
                </ul>
              )}
            </div>
          </details>
        )}
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={approve}
            disabled={working}
            className="min-h-[44px] flex-1 rounded-full bg-[#D4A843] px-5 font-medium text-[#050505] disabled:opacity-60"
          >
            {working ? 'Saving…' : 'Save plan'}
          </button>
          <button
            type="button"
            onClick={decline}
            disabled={working}
            className="min-h-[44px] rounded-full px-5 text-neutral-400 hover:text-neutral-200 disabled:opacity-60"
          >
            Not now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={box} role="group" aria-label="Approve this booking">
      <p className="font-mono text-[11px] uppercase tracking-wider text-[#D4A843]">Approval needed</p>
      <p className="mt-1 font-display text-lg text-neutral-100">{s.title}</p>
      <p className="text-neutral-400">{s.period}</p>
      {s.details && s.details.length > 0 && (
        <ul className="mt-3 space-y-1 text-[13px] text-neutral-300">
          {s.details.map((d) => <li key={d}>{d}</li>)}
        </ul>
      )}
      <dl className="mt-4 space-y-1.5 font-mono text-[13px]">
        {s.lines.map((l) => (
          <div key={l.label} className="flex justify-between gap-3"><dt>{l.label}</dt><dd>{rands(l.amountCents)}</dd></div>
        ))}
        {s.depositCents > 0 && (
          <div className="flex justify-between gap-3"><dt>Refundable deposit</dt><dd>{rands(s.depositCents)}</dd></div>
        )}
        <div className="flex justify-between gap-3 border-t border-white/10 pt-2 text-neutral-100"><dt>Total</dt><dd>{rands(s.totalCents)}</dd></div>
      </dl>
      {s.collection && <p className="mt-4 text-neutral-300">{s.collection}</p>}
      <p className="mt-4 text-[12px] text-neutral-400">{s.cancellationPolicy}</p>
      <p className="mt-2 text-[12px] text-neutral-400">{s.nextStep}</p>
      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={approve}
          disabled={working}
          className="min-h-[44px] flex-1 rounded-full bg-[#D4A843] px-5 font-medium text-[#050505] disabled:opacity-60"
        >
          {working ? 'Working…' : 'Approve'}
        </button>
        <button
          type="button"
          onClick={decline}
          disabled={working}
          className="min-h-[44px] rounded-full border border-white/15 px-5 text-neutral-300 disabled:opacity-60"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
