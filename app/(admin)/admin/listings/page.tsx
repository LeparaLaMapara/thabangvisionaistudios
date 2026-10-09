'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Ban, RotateCcw, Loader2, Sparkles } from 'lucide-react';
import { STUDIO } from '@/lib/constants';
import type { ListingStatus } from '@/lib/core/listings/review';

type QueueItem = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  category: string | null;
  sub_category: string | null;
  brand: string | null;
  model: string | null;
  price_per_day: number | null;
  deposit_amount: number | null;
  replacement_value: number | null;
  serial_number: string | null;
  replacement_value_evidence: string | null;
  thumbnail_url: string | null;
  gallery: { url: string; public_id: string }[] | null;
  metadata: { location?: string } | null;
  listing_status: ListingStatus;
  review_notes: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  owner_attestations: { terms_version?: string; accepted_at?: string } | null;
  owner_name: string | null;
  owner_checks: {
    id_verified: boolean;
    payout_account_verified: boolean;
    suspended: boolean;
    open_disputes: number;
    published_listings: number;
    completed_rentals: number;
    rejected_listings: number;
  } | null;
  unconfirmed_ai_fields: string[];
  blockers: string[];
  review_reasons: string[];
};

type Action = 'approve' | 'reject' | 'suspend' | 'reinstate';

const TABS: { status: ListingStatus; label: string }[] = [
  { status: 'pending_review', label: 'Pending review' },
  { status: 'published', label: 'Live' },
  { status: 'rejected', label: 'Not approved' },
  { status: 'suspended', label: 'Taken down' },
  { status: 'draft', label: 'Drafts' },
];

const ACTIONS_FOR: Record<ListingStatus, Action[]> = {
  pending_review: ['approve', 'reject', 'suspend'],
  published: ['suspend'],
  rejected: ['suspend'],
  draft: ['suspend'],
  suspended: ['reinstate'],
};

const ACTION_LABEL: Record<Action, string> = {
  approve: 'Approve',
  reject: 'Reject',
  suspend: 'Take down',
  reinstate: 'Reinstate as draft',
};

function money(n: number | null): string {
  return n === null ? '-' : `${STUDIO.currency.symbol}${Number(n).toLocaleString('en-ZA')}`;
}

async function fetchQueue(status: ListingStatus): Promise<{ items: QueueItem[] } | { error: string }> {
  try {
    const res = await fetch(`/api/admin/listings/review?status=${status}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) return { error: body?.error ?? 'Failed to load the queue.' };
    return { items: (body as QueueItem[]) ?? [] };
  } catch {
    return { error: 'Failed to load the queue.' };
  }
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${ok ? 'text-emerald-400' : 'text-red-400'}`}>
      {ok ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {label}
    </span>
  );
}

export default function AdminListingsReviewPage() {
  const [tab, setTab] = useState<ListingStatus>('pending_review');
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await fetchQueue(tab);
      if (cancelled) return;
      if ('error' in result) setError(result.error);
      else setItems(result.items);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  function selectTab(status: ListingStatus) {
    if (status === tab) return;
    setLoading(true);
    setError(null);
    setItems([]);
    setTab(status);
  }

  async function act(item: QueueItem, action: Action) {
    setError(null);
    setBusyId(item.id);
    try {
      const res = await fetch('/api/admin/listings/review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action, notes: notes[item.id] ?? '' }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const reasons = Array.isArray(body?.reasons)
          ? ` ${(body.reasons as { message: string }[]).map((r) => r.message).join(' ')}`
          : '';
        setError(`${body?.error ?? 'Failed.'}${reasons}`);
      } else {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
      }
    } catch {
      setError('Failed to record the review.');
    }
    setBusyId(null);
  }

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-10">
      <header className="mb-8">
        <h1 className="text-2xl md:text-3xl font-display text-white tracking-tight">Listing review</h1>
        <p className="text-sm text-neutral-400 mt-2">
          Community gear waiting for a person. Checked automatically: the owner&rsquo;s ID check, a validated
          payout bank account, required fields and the owner&rsquo;s declarations. Not checked by anyone yet:
          that the owner owns the gear, that it works, or that the replacement value is right.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 mb-6">
        {TABS.map((t) => (
          <button
            key={t.status}
            onClick={() => selectTab(t.status)}
            className={`min-h-[44px] px-4 text-xs font-mono uppercase tracking-widest border transition-colors ${
              tab === t.status
                ? 'border-[#D4A843] text-[#D4A843]'
                : 'border-white/10 text-neutral-400 hover:text-white hover:border-white/30'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 bg-red-950 border border-red-700/40 text-red-400 text-xs font-mono">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-neutral-400 font-mono text-sm py-10">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm font-mono text-neutral-500 py-10">Nothing here.</p>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const busy = busyId === item.id;
            const c = item.owner_checks;
            return (
              <div key={item.id} className="border border-white/10 bg-neutral-950 p-5">
                <div className="flex flex-col md:flex-row gap-5">
                  <div className="flex gap-2 flex-wrap md:w-48 flex-shrink-0">
                    {(item.gallery ?? (item.thumbnail_url ? [{ url: item.thumbnail_url, public_id: '' }] : []))
                      .slice(0, 4)
                      .map((g, i) => (
                        <a key={g.url + i} href={g.url} target="_blank" rel="noopener noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={g.url} alt="" className="w-20 h-20 object-cover border border-white/10" />
                        </a>
                      ))}
                  </div>

                  <div className="flex-1 min-w-0 space-y-2 text-xs font-mono">
                    <h2 className="text-sm text-white font-medium">{item.title}</h2>
                    <p className="text-neutral-400">
                      {[item.brand, item.model].filter(Boolean).join(' ') || 'No brand/model'} / {item.category ?? '-'}
                      {item.sub_category ? ` / ${item.sub_category}` : ''} / {item.metadata?.location ?? 'no location'}
                    </p>
                    <p className="text-neutral-300">
                      Day rate {money(item.price_per_day)} / Replacement value {money(item.replacement_value)} / Deposit{' '}
                      {money(item.deposit_amount)}
                    </p>
                    <p className="text-neutral-500">
                      Serial: {item.serial_number || 'not given'}
                      {item.replacement_value_evidence ? ` / Value evidence: ${item.replacement_value_evidence}` : ''}
                    </p>
                    {item.description && <p className="text-neutral-400 whitespace-pre-line">{item.description}</p>}

                    <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2">
                      <span className="text-neutral-400">Owner: {item.owner_name ?? 'unknown'}</span>
                      {c ? (
                        <>
                          <Check ok={c.id_verified} label="ID check" />
                          <Check ok={c.payout_account_verified} label="Payout account" />
                          <Check ok={!c.suspended} label="Not suspended" />
                          <Check ok={c.open_disputes === 0} label={`${c.open_disputes} open disputes`} />
                          <span className="text-neutral-400">
                            {c.published_listings} live / {c.completed_rentals} completed hires / {c.rejected_listings} rejected
                          </span>
                        </>
                      ) : (
                        <span className="text-red-400">Owner checks could not be loaded</span>
                      )}
                    </div>

                    <p className="text-neutral-500">
                      Declarations:{' '}
                      {item.owner_attestations?.accepted_at
                        ? `given ${new Date(item.owner_attestations.accepted_at).toLocaleString('en-ZA')} (terms ${item.owner_attestations.terms_version ?? '?'})`
                        : 'not given'}
                    </p>

                    {item.unconfirmed_ai_fields.length > 0 && (
                      <p className="text-[#D4A843] inline-flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> AI-suggested, not confirmed by owner:{' '}
                        {item.unconfirmed_ai_fields.join(', ')}
                      </p>
                    )}
                    {item.review_reasons.length > 0 && (
                      <p className="text-neutral-400">Why a review: {item.review_reasons.join(' ')}</p>
                    )}
                    {item.blockers.length > 0 && (
                      <p className="text-red-400">Cannot be approved yet: {item.blockers.join(' ')}</p>
                    )}
                    {item.review_notes && <p className="text-neutral-400">Last note: {item.review_notes}</p>}

                    <textarea
                      value={notes[item.id] ?? ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [item.id]: e.target.value }))}
                      rows={2}
                      placeholder="Note to the owner (required to reject or take down)"
                      className="w-full mt-2 bg-neutral-900 border border-white/10 text-white text-xs font-mono px-3 py-2 focus:outline-none focus:border-white/30 resize-none placeholder:text-neutral-500"
                    />

                    <div className="flex flex-wrap gap-2">
                      {ACTIONS_FOR[item.listing_status].map((action) => (
                        <button
                          key={action}
                          onClick={() => act(item, action)}
                          disabled={busy}
                          className={`min-h-[44px] px-4 inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest border transition-colors disabled:opacity-50 ${
                            action === 'approve'
                              ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                              : action === 'reinstate'
                                ? 'border-white/20 text-neutral-300 hover:bg-white/5'
                                : 'border-red-500/40 text-red-400 hover:bg-red-500/10'
                          }`}
                        >
                          {busy ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : action === 'approve' ? (
                            <CheckCircle className="w-3 h-3" />
                          ) : action === 'reinstate' ? (
                            <RotateCcw className="w-3 h-3" />
                          ) : action === 'suspend' ? (
                            <Ban className="w-3 h-3" />
                          ) : (
                            <XCircle className="w-3 h-3" />
                          )}
                          {ACTION_LABEL[action]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
