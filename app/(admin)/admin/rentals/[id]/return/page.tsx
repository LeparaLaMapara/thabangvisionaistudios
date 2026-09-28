'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Camera, Loader2 } from 'lucide-react';
import { uploadFile } from '@/lib/cloudinary/upload';
import { STUDIO } from '@/lib/constants';

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
}

const CONDITIONS = [
  { value: 'like_new', label: 'As it went out' },
  { value: 'good', label: 'Light wear, all fine' },
  { value: 'fair', label: 'Visible wear, works fully' },
  { value: 'for_parts', label: 'Damaged' },
];

const rand = (n: number): string => `${STUDIO.currency.symbol}${Math.round(n).toLocaleString(STUDIO.currency.locale)}`;

export default function TakeBackPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<TakeBack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [condition, setCondition] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [damage, setDamage] = useState('');
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<'eft' | 'cash' | ''>('');
  const [saving, setSaving] = useState(false);

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
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/admin/rentals/${id}/take-back`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ condition, photos, damageFee, note, refundMethod: method || undefined, dispute }),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(json.error ?? 'Could not complete the return.');
      if (json.card_failed) setData((d) => (d ? { ...d, deposit_on_card: false } : d));
      return;
    }
    router.push('/admin/bookings');
  };

  const ready = condition && photos.length > 0 && !uploading && !saving && (!needsMethod || method) && (damageFee === 0 || note.trim());

  return (
    <div className="max-w-2xl mx-auto p-6 md:p-10 space-y-8">
      <Link href="/admin/bookings" className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-400">
        <ArrowLeft className="w-3 h-3" /> Bookings
      </Link>
      <header>
        <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 mb-1">Take back</p>
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

      {data && (
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
              <input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => upload(e.target.files)} />
            </label>
            {uploading && <p className="text-xs text-neutral-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Uploading…</p>}
            {photos.length > 0 && <p className="text-xs text-neutral-400">{photos.length} photo(s) added</p>}
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
              <p className="text-xs text-neutral-400">It goes back to the card they paid with, automatically.</p>
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
