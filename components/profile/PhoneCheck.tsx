'use client';

import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

/**
 * Confirm a phone number with a one-time SMS code (TASK-069). Creators and
 * clients can then reach each other on the shoot day, and a confirmed number
 * is one of the checks behind higher gear limits.
 */
export function PhoneCheck({ phone, verified }: { phone: string; verified: boolean }) {
  const [step, setStep] = useState<'idle' | 'sent' | 'done'>(verified ? 'done' : 'idle');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const call = async (path: string, body: object) => {
    setBusy(true);
    setNote(null);
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    return { ok: res.ok, json };
  };

  if (step === 'done') {
    return (
      <p className="flex items-center gap-2 text-[11px] font-mono text-emerald-400 mt-2">
        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Number confirmed
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {step === 'idle' && (
        <button
          type="button"
          disabled={busy || !phone.trim()}
          onClick={async () => {
            const { ok, json } = await call('/api/phone/send', { phone });
            if (ok) {
              setStep('sent');
              setNote(`We sent a code to ${json.sentTo}.`);
            } else setNote(json.error ?? 'Could not send a code.');
          }}
          className="min-h-[44px] px-4 rounded border border-[#D4A843] text-[#D4A843] text-[10px] font-mono uppercase tracking-widest disabled:opacity-40"
        >
          {busy ? 'Sending…' : 'Confirm this number by SMS'}
        </button>
      )}
      {step === 'sent' && (
        <div className="flex gap-2">
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="6-digit code"
            aria-label="Code from the SMS"
            className="min-h-[44px] w-40 bg-transparent border border-white/20 rounded px-3 text-white font-mono tracking-[0.3em]"
          />
          <button
            type="button"
            disabled={busy || code.length !== 6}
            onClick={async () => {
              const { ok, json } = await call('/api/phone/verify', { code });
              if (ok) setStep('done');
              else setNote(json.error ?? 'That did not work.');
            }}
            className="min-h-[44px] px-4 rounded bg-[#D4A843] text-[#050505] text-[10px] font-mono uppercase tracking-widest disabled:opacity-40"
          >
            {busy ? 'Checking…' : 'Confirm'}
          </button>
        </div>
      )}
      {note && <p className="text-[11px] font-mono text-neutral-400">{note}</p>}
    </div>
  );
}
