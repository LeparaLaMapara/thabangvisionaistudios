'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Camera, Loader2 } from 'lucide-react';
import { uploadFile } from '@/lib/cloudinary/upload';
import { formatRand } from '@/lib/format/money';
import { uploadAccept } from '@/lib/storage/upload-policy';

/**
 * Taking gear back at the counter: the last step of the gear loop. Record the
 * condition, keep only what late return or damage costs, and give the rest of
 * the deposit back the way it was paid. The renter is told the outcome.
 */

interface TakeBack {
  id: string;
  status: string;
  title: string;
  end_date: string;
  quantity: number;
  deposit: number;
  late_fee: number;
  days_late: number;
  deposit_on_card: boolean;
  has_serial?: boolean;
}

const CONDITIONS = [
  { value: 'like_new', label: 'As it went out' },
  { value: 'good', label: 'Light wear, all fine' },
  { value: 'fair', label: 'Visible wear, works fully' },
  { value: 'for_parts', label: 'Damaged' },
];

const rand = (n: number): string => formatRand(n);

const FUNCTIONAL = [
  { value: 'working', label: 'Works' },
  { value: 'faulty', label: 'Faulty' },
  { value: 'not_tested', label: 'Not tested' },
] as const;
type Functional = (typeof FUNCTIONAL)[number]['value'];

/** Comma- or line-separated text to a clean list. */
const toList = (text: string): string[] =>
  text
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);

/** What the server said happened, shown before leaving the page. */
interface TakeBackResult {
  disputed?: boolean;
  outcome?: string;
  released?: number;
  kept?: number;
  late_fee?: number;
  refund_method?: string;
  refund_status?: string | null;
}

const OUTCOME_LABEL: Record<string, string> = {
  clean: 'Clean return',
  late: 'Returned late',
  damage: 'Damage or fault recorded',
  missing_parts: 'Parts missing',
};

/** Card refunds are sent to the provider; only cash/EFT are paid back by hand on the spot. */
function refundLine(r: TakeBackResult): string {
  const amount = rand(r.released ?? 0);
  if (!r.released) return 'Nothing goes back to the renter.';
  switch (r.refund_method) {
    case 'card':
      if (r.refund_status === 'escalated') {
        return `${amount} card refund could not be sent and needs a person. Open Rental ops and retry it from Refunds.`;
      }
      if (r.refund_status === undefined) {
        // Older databases refund directly and only answer once the provider accepted it.
        return `${amount} card refund accepted by the payment provider. It can take a few working days to reach the renter.`;
      }
      if (r.refund_status === 'unknown_outcome' || r.refund_status === null) {
        return `${amount} card refund recorded, but the payment provider did not answer. It has not been confirmed as sent; the daily pipeline reconciles it (never twice), and Rental ops shows its state.`;
      }
      return `${amount} card refund initiated with the payment provider (${r.refund_status}). It is not refunded until the provider confirms, which can take a few working days; Rental ops tracks it.`;
    case 'eft':
      return `${amount} to be paid back by EFT. Make the transfer now; the system does not send it.`;
    case 'cash':
      return `${amount} to be paid back in cash at the counter.`;
    default:
      return `${amount} back to the renter.`;
  }
}

export default function TakeBackPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<TakeBack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [condition, setCondition] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [damage, setDamage] = useState('');
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<'eft' | 'cash' | ''>('');
  const [saving, setSaving] = useState(false);
  const [serialsConfirmed, setSerialsConfirmed] = useState(false);
  const [accessoriesReturned, setAccessoriesReturned] = useState('');
  const [missingComponents, setMissingComponents] = useState('');
  const [functionalCheck, setFunctionalCheck] = useState<Functional>('not_tested');
  const [receivedBy, setReceivedBy] = useState('');
  const [result, setResult] = useState<TakeBackResult | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/rentals/${id}/take-back`)
      .then(async (res) => ({ ok: res.ok, json: await res.json() }))
      .then(({ ok, json }) => {
        if (!alive) return;
        if (ok) setData(json);
        else setError(json.error ?? 'Could not load the booking.');
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const a = await uploadFile(f, `thabangvision/returns/${id}`);
        setPhotos((p) => [...p, a.url]);
      }
    } catch {
      setError('A photo did not upload. Try again.');
    } finally {
      setUploading(false);
    }
  };

  const damageFee = Math.max(0, Number(damage) || 0);
  const kept = data ? Math.min(data.deposit, data.late_fee + damageFee) : 0;
  const release = data ? Math.max(0, data.deposit - kept) : 0;
  const needsMethod = release > 0 && !data?.deposit_on_card;

  const submit = async (dispute: boolean) => {
    if (!dispute && !serialsConfirmed && data?.has_serial !== false) {
      const go = window.confirm(
        'You have not confirmed the serial number. If this item has a registered serial, the return will be opened as a dispute and the deposit will not be settled. Continue?',
      );
      if (!go) return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/admin/rentals/${id}/take-back`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        condition,
        photos,
        damageFee,
        note,
        refundMethod: method || undefined,
        dispute,
        serialsConfirmed,
        accessoriesReturned: toList(accessoriesReturned),
        missingComponents: toList(missingComponents),
        functionalCheck,
        receivedBy: receivedBy.trim() || undefined,
      }),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setSaving(false);
    if (!res || !res.ok) {
      setError(json.error ?? 'Could not complete the return.');
      if (json.card_failed) setData((d) => (d ? { ...d, deposit_on_card: false } : d));
      return;
    }
    setResult(json as TakeBackResult);
  };

  const ready = condition && photos.length > 0 && !uploading && !saving && (!needsMethod || method) && (damageFee === 0 || note.trim());

  return (
    <div className="max-w-2xl mx-auto p-6 md:p-10 space-y-8">
      <Link href="/admin/bookings" className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-neutral-400">
        <ArrowLeft className="w-3 h-3" /> Bookings
      </Link>
      <header>
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-1">Take back</p>
        <h1 className="text-2xl font-display text-white tracking-tight">
          {data ? `${data.title}${data.quantity > 1 ? ` x${data.quantity}` : ''}` : 'Loading…'}
        </h1>
        {data && (
          <p className="text-xs font-mono text-neutral-400 mt-2">
            Due back {data.end_date}
            {data.days_late > 0 ? ` · ${data.days_late} day(s) late` : ' · on time'}
          </p>
        )}
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {data && !['active', 'overdue', 'return_pending'].includes(data.status) && (
        <p className="text-sm text-[#D4A843]">This booking is {data.status}; only gear that is out can be taken back.</p>
      )}

      {result && (
        <section role="status" className="border border-white/10 rounded p-4 space-y-3">
          <h2 className="text-xs font-mono uppercase tracking-widest text-[#D4A843]">
            {result.disputed ? 'Return recorded, opened as a dispute' : 'Return recorded'}
          </h2>
          {result.disputed ? (
            <p className="text-sm text-neutral-300">
              The gear is logged as back, but nothing has been settled: the deposit stays held and the item stays off sale until the
              dispute is resolved under Disputes.
              {(result.late_fee ?? 0) > 0 ? ` Late fee so far: ${rand(result.late_fee ?? 0)}.` : ''}
            </p>
          ) : (
            <>
              <dl className="space-y-1 text-sm font-mono">
                {result.outcome && (
                  <div className="flex justify-between"><dt className="text-neutral-400">Outcome</dt><dd className="text-white">{OUTCOME_LABEL[result.outcome] ?? result.outcome}</dd></div>
                )}
                <div className="flex justify-between"><dt className="text-neutral-400">Late fee</dt><dd className="text-white">{rand(result.late_fee ?? 0)}</dd></div>
                <div className="flex justify-between"><dt className="text-neutral-400">Kept from the deposit</dt><dd className="text-white">{rand(result.kept ?? 0)}</dd></div>
                <div className="flex justify-between"><dt className="text-neutral-400">Back to the renter</dt><dd className="text-[#D4A843]">{rand(result.released ?? 0)}</dd></div>
              </dl>
              <p className="text-sm text-neutral-300">{refundLine(result)}</p>
            </>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <Link href="/admin/bookings" className="flex-1 flex items-center justify-center min-h-[44px] rounded bg-[#D4A843] text-[#050505] text-xs font-mono font-bold uppercase tracking-widest">
              Back to bookings
            </Link>
            <Link href="/admin/rental-ops" className="flex-1 flex items-center justify-center min-h-[44px] rounded border border-white/20 text-white text-xs font-mono uppercase tracking-widest">
              Rental ops
            </Link>
          </div>
        </section>
      )}

      {data && !result && (
        <>
          <section className="space-y-3">
            <h2 className="text-xs font-mono uppercase tracking-widest text-white">1. Check the gear</h2>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              className="w-full min-h-[44px] bg-[#050505] border border-white/10 rounded px-3 text-sm text-white"
            >
              <option value="">How did it come back?</option>
              {CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <label className={`flex items-center justify-center gap-2 min-h-[44px] rounded border border-white/20 text-xs font-mono uppercase tracking-widest text-white cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
              <Camera className="w-4 h-4" aria-hidden="true" /> Photos of the returned gear
              <input type="file" accept={uploadAccept('image', true)} capture="environment" multiple className="sr-only" onChange={(e) => upload(e.target.files)} />
            </label>
            {uploading && <p className="text-xs text-neutral-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Uploading…</p>}
            {photos.length > 0 && <p className="text-xs text-neutral-400">{photos.length} photo(s) added</p>}

            <label className="flex items-start gap-3 min-h-[44px] text-sm text-white">
              <input type="checkbox" checked={serialsConfirmed} onChange={(e) => setSerialsConfirmed(e.target.checked)} className="w-5 h-5 mt-0.5" />
              <span>I read the serial number off the returned gear and it matches the one that went out.</span>
            </label>
            <p className="text-xs text-neutral-400">
              If this item has a registered serial and you cannot confirm it, the return is opened as a dispute: it may not be our unit,
              so the deposit is not settled and the gear stays off sale until someone resolves it.
            </p>

            <div>
              <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">Does it work?</p>
              <div className="flex gap-2">
                {FUNCTIONAL.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFunctionalCheck(f.value)}
                    aria-pressed={functionalCheck === f.value}
                    className={`flex-1 min-h-[44px] rounded border text-xs font-mono uppercase tracking-widest ${functionalCheck === f.value ? 'border-[#D4A843] text-[#D4A843]' : 'border-white/20 text-neutral-400'}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="block text-xs text-neutral-400 space-y-1">
              <span>Accessories returned (comma or line separated)</span>
              <textarea
                value={accessoriesReturned}
                onChange={(e) => setAccessoriesReturned(e.target.value)}
                rows={2}
                placeholder="e.g. 2 batteries, charger, lens cap, case"
                className="w-full bg-transparent border border-white/10 rounded px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="block text-xs text-neutral-400 space-y-1">
              <span>Missing components (leave empty if nothing is missing)</span>
              <textarea
                value={missingComponents}
                onChange={(e) => setMissingComponents(e.target.value)}
                rows={2}
                placeholder="e.g. lens cap"
                className="w-full bg-transparent border border-white/10 rounded px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="block text-xs text-neutral-400 space-y-1">
              <span>Received by (staff name)</span>
              <input
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
                maxLength={120}
                className="w-full min-h-[44px] bg-transparent border border-white/10 rounded px-3 text-sm text-white"
              />
            </label>
          </section>

          <section className="space-y-3">
            <h2 className="text-xs font-mono uppercase tracking-widest text-white">2. Settle the deposit</h2>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-neutral-400 space-y-1">
                <span>Damage charge (R)</span>
                <input inputMode="decimal" value={damage} onChange={(e) => setDamage(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" className="w-full min-h-[44px] bg-transparent border border-white/10 rounded px-3 text-white font-mono" />
              </label>
              <label className="text-xs text-neutral-400 space-y-1 col-span-2">
                <span>What for (the renter sees this)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Only needed for a damage charge or dispute" className="w-full min-h-[44px] bg-transparent border border-white/10 rounded px-3 text-white" />
              </label>
            </div>
            <dl className="border border-white/10 rounded p-4 space-y-1 text-sm font-mono">
              <div className="flex justify-between"><dt className="text-neutral-400">Deposit</dt><dd className="text-white">{rand(data.deposit)}</dd></div>
              <div className="flex justify-between"><dt className="text-neutral-400">Late fee</dt><dd className="text-white">{rand(data.late_fee)}</dd></div>
              <div className="flex justify-between"><dt className="text-neutral-400">Damage</dt><dd className="text-white">{rand(Math.min(damageFee, data.deposit))}</dd></div>
              <div className="flex justify-between border-t border-white/10 pt-1"><dt className="text-white">Back to the renter</dt><dd className="text-[#D4A843]">{rand(release)}</dd></div>
            </dl>
            {release > 0 && data.deposit_on_card && (
              <p className="text-xs text-neutral-400">
                A refund to the card they paid with is initiated with the payment provider. It is not instant; Rental ops tracks it until the provider confirms.
              </p>
            )}
            {needsMethod && (
              <div className="flex gap-2">
                {(['eft', 'cash'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={`flex-1 min-h-[44px] rounded border text-xs font-mono uppercase tracking-widest ${method === m ? 'border-[#D4A843] text-[#D4A843]' : 'border-white/20 text-neutral-400'}`}
                  >
                    Paid back by {m === 'eft' ? 'EFT' : 'cash'}
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="space-y-3">
            <button
              onClick={() => submit(false)}
              disabled={!ready}
              className="w-full min-h-[48px] rounded bg-[#D4A843] text-[#050505] text-xs font-mono font-bold uppercase tracking-widest disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Complete the return'}
            </button>
            <button
              onClick={() => submit(true)}
              disabled={!condition || photos.length === 0 || !note.trim() || saving}
              className="w-full min-h-[44px] rounded border border-red-500/40 text-red-400 text-xs font-mono uppercase tracking-widest disabled:opacity-40"
            >
              Something is wrong: open a dispute instead
            </button>
          </div>
        </>
      )}
    </div>
  );
}
