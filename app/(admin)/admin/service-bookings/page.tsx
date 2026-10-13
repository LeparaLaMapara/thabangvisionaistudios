'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, UserRound, X } from 'lucide-react';
import { formatRand } from '@/lib/format/money';
import { useAdminUI } from '@/components/admin/shell/AdminUI';

interface Booking {
  id: string;
  reference: string;
  client_id: string;
  client_email: string;
  client_name: string | null;
  creator_id: string | null;
  project_category: string;
  project_description: string;
  deliverables: string;
  duration_hours: number;
  location: string | null;
  preferred_dates: string | null;
  shoot_date: string | null;
  total: number;
  platform_amount: number;
  creator_amount: number;
  payment_status: string;
  payout_status: string;
  status: string;
  cancellation_refund_status: string | null;
  paid_at: string | null;
  accepted_at: string | null;
  created_at: string;
  creator: { id: string; display_name: string | null } | null;
}

interface CreatorOption {
  id: string;
  name: string;
  place: string | null;
  skills: string[];
  hourlyRate: number | null;
  availableForHire: boolean;
}

/** Plain words for each status, and the colour of its tag. */
const STATUS: Record<string, { label: string; cls: string }> = {
  paid: { label: 'Waiting for the creator to accept', cls: 'bg-sky-500/10 text-sky-300' },
  pending_reassignment: { label: 'Needs a new creator', cls: 'bg-red-500/10 text-red-300' },
  accepted: { label: 'Booked', cls: 'bg-emerald-500/10 text-emerald-300' },
  delivered: { label: 'Work delivered, client checking', cls: 'bg-cyan-500/10 text-cyan-300' },
  completed: { label: 'Done, creator to be paid', cls: 'bg-amber-500/10 text-amber-300' },
  paid_out: { label: 'Done and creator paid', cls: 'bg-purple-500/10 text-purple-300' },
  cancelled: { label: 'Cancelled', cls: 'bg-neutral-500/10 text-neutral-400' },
  declined: { label: 'Declined by creator', cls: 'bg-neutral-500/10 text-neutral-400' },
  disputed: { label: 'Disputed', cls: 'bg-orange-500/10 text-orange-300' },
};

const PAYOUT: Record<string, string> = {
  pending: 'not paid yet',
  processing: 'on its way',
  paid: 'paid',
  failed: 'failed, try again',
};

const TABS: { id: string; label: string; match: (b: Booking) => boolean }[] = [
  { id: 'todo', label: 'Needs you', match: (b) => needsYou(b) },
  { id: 'live', label: 'Coming up', match: (b) => ['paid', 'accepted', 'delivered'].includes(b.status) },
  { id: 'done', label: 'Done', match: (b) => ['completed', 'paid_out'].includes(b.status) },
  { id: 'cancelled', label: 'Cancelled', match: (b) => ['cancelled', 'declined'].includes(b.status) },
  { id: 'all', label: 'All', match: () => true },
];

function needsYou(b: Booking): boolean {
  if (b.status === 'pending_reassignment') return true;
  if (b.status === 'completed' && (b.payout_status === 'pending' || b.payout_status === 'failed')) return true;
  if (b.cancellation_refund_status === 'failed' || b.cancellation_refund_status === 'manual_review') return true;
  if (b.status === 'paid' && b.paid_at && Date.now() - new Date(b.paid_at).getTime() > 24 * 3600 * 1000) return true;
  return false;
}

function when(d: string | null): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Search-as-you-type list of ID-checked creators. */
function CreatorPicker({ booking, onPick, onClose }: { booking: Booking; onPick: (c: CreatorOption) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<CreatorOption[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/admin/creators?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal, cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: { creators?: CreatorOption[] }) => {
          setList(d.creators ?? []);
          setFailed(false);
        })
        .catch((e: unknown) => {
          if ((e as { name?: string }).name !== 'AbortError') setFailed(true);
        });
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const options = (list ?? []).filter((c) => c.id !== booking.creator_id && c.id !== booking.client_id);

  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="pick-h">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/75" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#111]">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 p-5">
          <div>
            <h2 id="pick-h" className="font-display text-lg text-white">Choose a creator</h2>
            <p className="mt-1 text-sm text-neutral-400">
              {booking.project_category} for {booking.client_name ?? booking.client_email}
              {booking.shoot_date ? `, ${when(booking.shoot_date)}` : ''}. They get {formatRand(booking.creator_amount)} once the work is done.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="-m-2 p-2 text-neutral-400 hover:text-white">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="border-b border-white/10 p-3">
          <label className="flex items-center gap-2 rounded-lg border border-white/15 bg-black/40 px-3">
            <Search className="h-4 w-4 text-neutral-400" aria-hidden="true" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or town"
              aria-label="Search creators"
              className="h-11 flex-1 bg-transparent text-base text-white placeholder:text-neutral-500 focus:outline-none"
            />
          </label>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {list === null && !failed && <li className="p-5 text-sm text-neutral-400">Loading creators…</li>}
          {failed && <li className="p-5 text-sm text-red-300">Could not load creators. Close this and try again.</li>}
          {list !== null && options.length === 0 && (
            <li className="p-5 text-sm text-neutral-400">No ID-checked creator matches. Creators appear here once their ID is approved.</li>
          )}
          {options.map((c) => (
            <li key={c.id} className="border-b border-white/[0.06] last:border-0">
              <button type="button" onClick={() => onPick(c)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-white/[0.04]">
                <UserRound className="h-5 w-5 flex-shrink-0 text-neutral-500" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] text-white">{c.name}</span>
                  <span className="block truncate text-xs text-neutral-400">
                    {[c.place, c.skills.join(', '), c.hourlyRate ? `${formatRand(c.hourlyRate)} an hour` : null].filter(Boolean).join(' · ') || 'No details yet'}
                  </span>
                </span>
                {!c.availableForHire && <span className="flex-shrink-0 text-xs text-neutral-500">Not taking work</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function AdminServiceBookingsPage() {
  const ui = useAdminUI();
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState('todo');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [picking, setPicking] = useState<Booking | null>(null);
  /** A booking opened from a link (?open=<id>): shown first and outlined. */
  const [focusId, setFocusId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/service-bookings', { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as { bookings?: Booking[] };
      setBookings(d.bookings ?? []);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    // Fetched after the page shows; the list fills in when it arrives.
    void load().then(() => {
      const open = new URLSearchParams(window.location.search).get('open');
      if (!open) return;
      setFocusId(open);
      setTab('all');
      window.history.replaceState(null, '', window.location.pathname);
      setTimeout(() => document.getElementById(`booking-${open}`)?.scrollIntoView({ block: 'center' }), 50);
    });
  }, [load]);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.id, (bookings ?? []).filter(t.match).length])), [bookings]);
  const shown = (bookings ?? []).filter(TABS.find((t) => t.id === tab)!.match);
  const clientOf = (b: Booking) => b.client_name ?? b.client_email;
  const creatorOf = (b: Booking) => b.creator?.display_name ?? 'the creator';

  async function send(b: Booking, url: string, init: RequestInit, done: (data: Record<string, unknown>) => string) {
    setBusyId(b.id);
    try {
      const r = await fetch(url, init);
      const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) {
        const reasons = Array.isArray(data.reasons) && data.reasons.length ? ` (${(data.reasons as string[]).join('; ')})` : '';
        ui.notify(`${String(data.error ?? 'That did not work.')}${reasons}`, 'bad');
      } else {
        ui.notify(done(data), 'good');
      }
    } catch {
      ui.notify('No answer from the server. Nothing was changed on this screen; refresh and check.', 'bad');
    } finally {
      setBusyId(null);
      await load();
    }
  }

  async function assign(b: Booking, c: CreatorOption) {
    setPicking(null);
    const swap = Boolean(b.creator_id);
    const ok = await ui.confirm({
      title: swap ? `Give this booking to ${c.name} instead?` : `Give this booking to ${c.name}?`,
      body: `${b.project_category} for ${clientOf(b)}. ${c.name} is asked to accept it${swap ? `, and ${creatorOf(b)} is told it moved` : ''}.`,
      action: `Give it to ${c.name}`,
    });
    if (!ok) return;
    await send(
      b,
      `/api/admin/service-bookings/${b.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creator_id: c.id }) },
      () => `${c.name} has the booking and has been asked to accept it.`,
    );
  }

  async function payout(b: Booking) {
    const ok = await ui.confirm({
      title: `Pay ${creatorOf(b)} ${formatRand(b.creator_amount)}?`,
      body: `For ${b.project_category} for ${clientOf(b)} (${b.reference}). The money goes to their bank account through the payment provider. It is only sent if the booking is complete, nothing is disputed and their bank account is checked.`,
      action: `Pay ${formatRand(b.creator_amount)}`,
    });
    if (!ok) return;
    await send(b, `/api/admin/service-bookings/${b.id}/payout`, { method: 'POST' }, (d) =>
      d.outcome === 'reconciled_paid' ? `That payout had already gone through; it is now recorded.` : `Payout of ${formatRand(b.creator_amount)} sent to ${creatorOf(b)}.`,
    );
  }

  async function cancel(b: Booking) {
    const paid = b.payment_status === 'paid';
    const reason = await ui.ask({
      title: `Cancel ${clientOf(b)}'s booking?`,
      body: paid
        ? `${clientOf(b)} gets ${formatRand(b.total)} back. ${b.creator_id ? `${creatorOf(b)} is told the job is off.` : ''}`
        : 'Nothing was paid, so nothing is refunded.',
      label: 'Why is it cancelled? The client sees this.',
      placeholder: 'For example: the creator is ill and nobody else is free that day',
      multiline: true,
      action: paid ? `Cancel and refund ${formatRand(b.total)}` : 'Cancel booking',
      danger: true,
    });
    if (!reason) return;
    await send(
      b,
      `/api/admin/service-bookings/${b.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled', cancellation_reason: reason }) },
      (d) =>
        d.refund_status === 'refunded'
          ? `Cancelled. ${formatRand(b.total)} is on its way back to ${clientOf(b)}.`
          : d.refund_status
            ? `Cancelled. The refund needs a person (${String(d.refund_status).replace(/_/g, ' ')}); you have an email with the details.`
            : 'Cancelled.',
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-10">
      <p className="text-sm text-neutral-400">Bookings</p>
      <h1 className="mt-1 font-display text-3xl text-white">Crew and studio bookings</h1>
      <p className="mt-2 text-neutral-300">Photographers, videographers and shoots people booked and paid for.</p>

      <div className="mt-6 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Show">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`min-h-[40px] flex-shrink-0 rounded-full border px-4 text-sm ${
              tab === t.id ? 'border-accent-gold bg-accent-gold/10 text-white' : 'border-white/10 text-neutral-400 hover:text-white'
            }`}
          >
            {t.label} <span className="tabular-nums text-neutral-500">{counts[t.id] ?? 0}</span>
          </button>
        ))}
      </div>

      {loadError && (
        <p className="mt-6 rounded-xl border border-red-500/30 p-4 text-sm text-red-200">
          Could not load the bookings.{' '}
          <button type="button" className="underline" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}
      {bookings === null && !loadError && <p className="mt-10 text-center text-neutral-400">Loading bookings…</p>}
      {bookings !== null && shown.length === 0 && (
        <p className="mt-10 rounded-2xl border border-white/10 p-10 text-center text-neutral-400">
          {tab === 'todo' ? 'Nothing here needs you.' : 'No bookings here.'}
        </p>
      )}

      <ul className="mt-6 space-y-3">
        {shown.map((b) => {
          const st = STATUS[b.status] ?? { label: b.status.replace(/_/g, ' '), cls: 'bg-white/5 text-neutral-300' };
          const busy = busyId === b.id;
          const canAssign = b.status === 'paid' || b.status === 'pending_reassignment';
          const canPay = b.status === 'completed' && (b.payout_status === 'pending' || b.payout_status === 'failed') && Boolean(b.creator_id);
          const canCancel = ['paid', 'accepted', 'pending_reassignment'].includes(b.status);
          return (
            <li
              key={b.id}
              id={`booking-${b.id}`}
              className={`rounded-2xl border bg-white/[0.02] p-5 ${focusId === b.id ? 'border-accent-gold' : 'border-white/10'}`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs ${st.cls}`}>{st.label}</span>
                  <h2 className="mt-2 text-lg font-medium text-white">
                    {b.project_category} for {clientOf(b)}
                  </h2>
                  <p className="mt-0.5 text-sm text-neutral-400">
                    {b.creator_id ? `Creator: ${creatorOf(b)}` : 'No creator yet'}
                    {b.shoot_date ? ` · ${when(b.shoot_date)}` : b.preferred_dates ? ` · ${b.preferred_dates}` : ''}
                    {b.location ? ` · ${b.location}` : ''}
                    {b.duration_hours ? ` · ${b.duration_hours} hours` : ''}
                  </p>
                </div>
                <div className="flex-shrink-0 text-left sm:text-right">
                  <p className="font-display text-2xl tabular-nums text-white">{formatRand(b.total)}</p>
                  <p className="text-xs text-neutral-400">
                    Creator {formatRand(b.creator_amount)} ({PAYOUT[b.payout_status] ?? b.payout_status}) · Us {formatRand(b.platform_amount)}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-neutral-500">{b.reference}</p>
                </div>
              </div>
              {b.project_description && <p className="mt-3 text-sm text-neutral-300">{b.project_description}</p>}
              {b.cancellation_refund_status && b.cancellation_refund_status !== 'not_required' && (
                <p className="mt-2 text-sm text-amber-200">Refund: {b.cancellation_refund_status.replace(/_/g, ' ')}</p>
              )}

              {(canAssign || canPay || canCancel) && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {canAssign && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setPicking(b)}
                      className="min-h-[44px] rounded-full bg-foreground px-5 text-sm font-semibold text-background disabled:opacity-50"
                    >
                      {b.creator_id ? 'Give to another creator' : 'Choose creator'}
                    </button>
                  )}
                  {canPay && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void payout(b)}
                      className="min-h-[44px] rounded-full bg-foreground px-5 text-sm font-semibold text-background disabled:opacity-50"
                    >
                      {b.payout_status === 'failed' ? 'Try the payout again' : `Pay ${creatorOf(b)}`}
                    </button>
                  )}
                  {canCancel && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void cancel(b)}
                      className="min-h-[44px] rounded-full border border-red-500/40 px-5 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      Cancel and refund
                    </button>
                  )}
                  {busy && <span className="self-center text-sm text-neutral-400">Working…</span>}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {picking && <CreatorPicker booking={picking} onPick={(c) => void assign(picking, c)} onClose={() => setPicking(null)} />}
    </div>
  );
}
