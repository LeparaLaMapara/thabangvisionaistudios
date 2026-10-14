'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { STUDIO } from '@/lib/constants';

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
  // Hidden until a phone check is switched on (no SMS or WhatsApp sender yet).
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (verified) return;
    let live = true;
    fetch('/api/phone/status')
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((j: { available?: boolean }) => { if (live) setAvailable(j.available === true); })
      .catch(() => { if (live) setAvailable(false); });
    return () => { live = false; };
  }, [verified]);

  const call = async (path: string, body: object) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, json };
    } catch {
      return { ok: false, status: 0, json: { error: 'Could not reach us. Check your connection and try again.' } };
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done') {
    return (
      <p id="phone" className="flex items-center gap-2 text-xs font-mono text-emerald-400 mt-2">
        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Number confirmed
      </p>
    );
  }

  if (available !== true) return null;

  return (
    <div id="phone" className="mt-2 space-y-2 scroll-mt-24">
      {step === 'idle' && (
        <button
          type="button"
          disabled={busy || !phone.trim()}
          onClick={async () => {
            const { ok, status, json } = await call('/api/phone/send', { phone });
            if (ok) {
              setStep('sent');
              setNote(`We sent a code to ${json.sentTo}.`);
            } else if (status === 503) {
              // SMS is not set up yet: say so honestly and give a way forward.
              setNote(`Phone checks are not available online yet. To rent before they are, contact us on WhatsApp ${STUDIO.whatsapp.display} or at ${STUDIO.email}.`);
            } else setNote(json.error ?? 'Could not send a code.');
          }}
          className="min-h-[44px] px-4 rounded border border-[#D4A843] text-[#D4A843] text-xs font-mono uppercase tracking-widest disabled:opacity-40"
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
            className="min-h-[44px] px-4 rounded bg-[#D4A843] text-[#050505] text-xs font-mono uppercase tracking-widest disabled:opacity-40"
          >
            {busy ? 'Checking…' : 'Confirm'}
          </button>
        </div>
      )}
      {note && <p role="status" className="text-xs font-mono text-neutral-400">{note}</p>}
    </div>
  );
}
