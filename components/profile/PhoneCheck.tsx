'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { STUDIO } from '@/lib/constants';

type Channel = 'whatsapp' | 'sms' | 'off' | 'loading';

interface WhatsappStart {
  code: string;
  link: string;
  sendFrom: string;
  expiresInMinutes: number;
}

/**
 * Confirm a phone number (TASK-069). Creators and clients can then reach each
 * other on the shoot day, and a confirmed number is one of the checks behind
 * higher gear limits.
 *
 * The server picks the channel (PHONE_VERIFY_CHANNEL, lib/phone-verify):
 *   whatsapp  the person sends a prefilled code to our WhatsApp number from
 *             their own WhatsApp; the page polls until the webhook confirms it.
 *   sms       a 6-digit code by SMS, typed back here.
 *   off       neither is set up: nothing is shown (the phone step is then
 *             not required either, lib/sms/availability.ts).
 */
export function PhoneCheck({
  phone,
  verified,
  onVerified,
}: {
  phone: string;
  verified: boolean;
  /** Called with the confirmed number (E.164) so the page can show it as saved. */
  onVerified?: (phone: string) => void;
}) {
  const [step, setStep] = useState<'idle' | 'sent' | 'waiting' | 'done'>(verified ? 'done' : 'idle');
  const [channel, setChannel] = useState<Channel>('loading');
  const [code, setCode] = useState('');
  const [wa, setWa] = useState<WhatsappStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const pollUntil = useRef(0);

  const notOnYet = `Phone checks are not available online yet. To rent before they are, contact us on WhatsApp ${STUDIO.whatsapp.display} or at ${STUDIO.email}.`;

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

  /** Asks the server for the channel and whether the number is confirmed. */
  const checkStatus = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/phone/status', { cache: 'no-store' });
      if (!res.ok) return false;
      const json = (await res.json()) as { channel?: Channel; verified?: boolean; phone?: string | null };
      if (json.channel) setChannel(json.channel);
      if (json.verified && json.phone) {
        setStep('done');
        onVerified?.(json.phone);
        return true;
      }
    } catch {
      /* offline: try again on the next tick */
    }
    return false;
  }, [onVerified]);

  // Learn the channel once (skipped when already confirmed).
  useEffect(() => {
    if (step === 'done') return;
    let alive = true;
    fetch('/api/phone/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { available?: boolean; channel?: Channel } | null) => {
        if (alive) setChannel(json?.available === true && json.channel ? json.channel : 'off');
      })
      .catch(() => alive && setChannel('off'));
    return () => {
      alive = false;
    };
    // Only on mount: the channel is deployment config.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While a WhatsApp check is open, poll until confirmed or the code expires.
  useEffect(() => {
    if (step !== 'waiting') return;
    const timer = window.setInterval(async () => {
      if (Date.now() > pollUntil.current) {
        window.clearInterval(timer);
        setStep('idle');
        setWa(null);
        setNote('That code has expired. Start again.');
        return;
      }
      if (await checkStatus()) window.clearInterval(timer);
    }, STUDIO.phoneVerify.pollSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [step, checkStatus]);

  if (step === 'done') {
    return (
      <p id="phone" className="flex items-center gap-2 text-xs font-mono text-emerald-400 mt-2">
        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Number confirmed
      </p>
    );
  }

  // Hidden until a phone check is switched on (lib/sms/availability.ts):
  // nobody is shown a step they cannot complete.
  if (channel === 'loading' || channel === 'off') return null;

  const buttonClass =
    'min-h-[44px] px-4 rounded border border-[#D4A843] text-[#D4A843] text-xs font-mono uppercase tracking-widest disabled:opacity-40';

  return (
    <div id="phone" className="mt-2 space-y-2 scroll-mt-24">
      {channel === 'whatsapp' && step === 'idle' && (
        <button
          type="button"
          disabled={busy || !phone.trim()}
          onClick={async () => {
            const { ok, status, json } = await call('/api/phone/whatsapp/start', { phone });
            if (ok) {
              setWa(json as WhatsappStart);
              pollUntil.current = Date.now() + (json as WhatsappStart).expiresInMinutes * 60_000;
              setStep('waiting');
            } else if (status === 503) {
              setNote(notOnYet);
            } else setNote(json.error ?? 'Could not start the check.');
          }}
          className={buttonClass}
        >
          {busy ? 'Starting…' : 'Verify on WhatsApp'}
        </button>
      )}

      {step === 'waiting' && wa && (
        <div className="space-y-2 rounded border border-white/10 p-3">
          <p className="text-xs font-mono text-neutral-300">
            Send this message from the WhatsApp on {wa.sendFrom}. Do not change the code.
          </p>
          <p className="font-mono text-lg tracking-[0.2em] text-[#D4A843]" aria-label="Your code">{wa.code}</p>
          <div className="flex flex-wrap gap-2">
            <a
              href={wa.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center min-h-[44px] px-4 rounded bg-[#D4A843] text-[#050505] text-xs font-mono uppercase tracking-widest"
            >
              Open WhatsApp
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const done = await checkStatus();
                setBusy(false);
                if (!done) setNote('Not received yet. It can take a few seconds after you send it.');
              }}
              className={buttonClass}
            >
              {busy ? 'Checking…' : "I've sent it"}
            </button>
          </div>
          <p className="text-xs font-mono text-neutral-400">
            The code works for {wa.expiresInMinutes} minutes. This page updates by itself once it arrives.
          </p>
        </div>
      )}

      {channel === 'sms' && step === 'idle' && (
        <button
          type="button"
          disabled={busy || !phone.trim()}
          onClick={async () => {
            const { ok, status, json } = await call('/api/phone/send', { phone });
            if (ok) {
              setStep('sent');
              setNote(`We sent a code to ${json.sentTo}.`);
            } else if (status === 503) {
              setNote(notOnYet);
            } else setNote(json.error ?? 'Could not send a code.');
          }}
          className={buttonClass}
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
