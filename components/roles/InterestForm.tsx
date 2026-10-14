'use client';

import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

/**
 * "Coming soon, leave your number." No account needed: one field, one button.
 */
export function InterestForm({ roleSlug, roleName }: { roleSlug: string; roleName: string }) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (state === 'done') {
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-300 min-h-[44px]" role="status">
        <Check className="w-4 h-4" aria-hidden="true" /> Thank you. We will send you a message when it opens.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[44px] px-4 text-xs font-mono uppercase tracking-widest border border-white/20 text-neutral-200 hover:border-accent-gold hover:text-accent-gold transition-colors"
      >
        Leave your number
      </button>
    );
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setState('sending');
    try {
      const res = await fetch('/api/roles/interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_slug: roleSlug, phone }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? 'Could not save that. Please try again.');
        setState('idle');
        return;
      }
      setState('done');
    } catch {
      setError('No connection. Please try again.');
      setState('idle');
    }
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-2">
      <label htmlFor={`phone-${roleSlug}`} className="text-xs text-neutral-400">
        Your WhatsApp or phone number, for {roleName.toLowerCase()}
      </label>
      <div className="flex gap-2">
        <input
          id={`phone-${roleSlug}`}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="072 123 4567"
          className="flex-1 min-w-0 min-h-[44px] px-3 bg-black/40 border border-white/15 text-white placeholder:text-neutral-500 focus:border-accent-gold outline-none"
        />
        <button
          type="submit"
          disabled={state === 'sending'}
          className="min-h-[44px] min-w-[44px] px-4 bg-accent-gold text-black text-xs font-mono uppercase tracking-widest disabled:opacity-50"
        >
          {state === 'sending' ? <Loader2 className="w-4 h-4 animate-spin" aria-label="Sending" /> : 'Send'}
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-300" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
