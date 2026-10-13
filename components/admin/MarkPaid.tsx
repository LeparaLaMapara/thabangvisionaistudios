'use client';

import { useState } from 'react';

/**
 * Record a payment taken by hand (EFT, cash, or a card link sent on WhatsApp)
 * and confirm the booking. The renter gets their confirmation straight away.
 */
export function MarkPaid({ bookingId, suggestedAmount, onDone }: { bookingId: string; suggestedAmount: number; onDone: () => void }) {
  const [method, setMethod] = useState<'eft' | 'cash' | 'card_link'>('eft');
  const [amount, setAmount] = useState(String(suggestedAmount || ''));
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/equipment-bookings/${bookingId}/mark-paid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, amount: Number(amount), reference }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) setError(json.error ?? 'Could not record the payment.');
    else {
      if (typeof json.warning === 'string') window.alert(json.warning);
      onDone();
    }
  };

  return (
    <div className="border border-[#D4A843]/30 rounded p-4 space-y-3">
      <p className="text-xs font-mono uppercase tracking-widest text-[#D4A843]">Payment received by hand</p>
      <div className="flex gap-2">
        {([['eft', 'EFT'], ['cash', 'Cash'], ['card_link', 'Card link']] as const).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            className={`flex-1 min-h-[40px] rounded border text-xs font-mono uppercase tracking-widest ${method === m ? 'border-[#D4A843] text-[#D4A843]' : 'border-white/15 text-neutral-400'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Amount received" placeholder="Amount (R)" className="min-h-[40px] bg-transparent border border-white/15 rounded px-3 text-sm text-white font-mono" />
        <input value={reference} onChange={(e) => setReference(e.target.value)} aria-label="Reference" placeholder="Reference (optional)" className="min-h-[40px] bg-transparent border border-white/15 rounded px-3 text-sm text-white" />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={busy || !(Number(amount) > 0)}
        className="w-full min-h-[44px] rounded bg-[#D4A843] text-[#050505] text-xs font-mono font-bold uppercase tracking-widest disabled:opacity-40"
      >
        {busy ? 'Saving…' : 'Mark as paid and confirm'}
      </button>
    </div>
  );
}
