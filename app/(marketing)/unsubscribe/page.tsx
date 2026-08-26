'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { STUDIO } from '@/lib/constants';

type Status = 'idle' | 'loading' | 'done' | 'error';

/**
 * Public unsubscribe page. Reachable without an account, because the people who
 * most need it are the ones who only ever gave us an email address.
 *
 * If ?email= is present the request fires on load, so a link in an email is
 * genuinely one click.
 */
export default function UnsubscribePage() {
  const params = useSearchParams();
  const prefilled = params.get('email') ?? '';

  const [email, setEmail] = useState(prefilled);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  const submit = useCallback(async (address: string) => {
    const trimmed = address.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setStatus('error');
      setMessage('Please enter a valid email address.');
      return;
    }

    setStatus('loading');
    try {
      const res = await fetch('/api/newsletter/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus('error');
        setMessage(data.error ?? 'Something went wrong.');
        return;
      }

      setStatus('done');
      setMessage(data.message ?? 'You have been unsubscribed.');
    } catch {
      setStatus('error');
      setMessage('Network error. Please check your connection and try again.');
    }
  }, []);

  useEffect(() => {
    if (prefilled) void submit(prefilled);
    // Only ever fire once, for the link-in-email case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const link = 'text-[#D4A843] hover:text-[#D4A843]/80 transition-colors';

  return (
    <div className="min-h-screen bg-[#050505] pt-32 pb-20">
      <div className="container mx-auto px-6 max-w-xl">
        <span className="text-[10px] font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-3 block">
          Email preferences
        </span>
        <h1 className="text-3xl md:text-5xl font-display font-medium text-white uppercase tracking-tight">
          Unsubscribe
        </h1>
        <div className="w-8 h-px bg-[#D4A843] mt-6 mb-10" />

        {status === 'done' ? (
          <div className="space-y-4 text-sm font-mono text-neutral-400 leading-relaxed">
            <p className="text-white">{message}</p>
            <p>
              You will still receive messages about bookings you have made with us, such as
              confirmations and deposit notices. Those are part of our contract with you and
              are not marketing.
            </p>
            <p>
              Changed your mind? Sign up again from the footer on any page, or read our{' '}
              <Link href="/privacy" className={link}>Privacy Policy</Link>.
            </p>
          </div>
        ) : (
          <div className="space-y-6 text-sm font-mono text-neutral-400 leading-relaxed">
            <p>
              Enter the email address you subscribed with and we will remove it from our
              marketing list. No account or password needed.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit(email);
              }}
              className="space-y-4"
            >
              <label htmlFor="unsub-email" className="sr-only">
                Email address
              </label>
              <input
                id="unsub-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full bg-transparent border border-white/15 px-4 py-3 text-white placeholder:text-neutral-600 focus:border-[#D4A843] focus:outline-none"
              />
              <button
                type="submit"
                disabled={status === 'loading'}
                className="w-full min-h-[44px] bg-[#D4A843] text-black text-[11px] font-mono font-bold uppercase tracking-widest px-6 py-3 disabled:opacity-50 hover:opacity-90 transition-opacity"
              >
                {status === 'loading' ? 'Removing…' : 'Unsubscribe'}
              </button>
            </form>

            {status === 'error' && (
              <p className="text-red-400" role="alert">{message}</p>
            )}

            <p className="text-neutral-500">
              Trouble with this? Email{' '}
              <a href={`mailto:${STUDIO.privacyEmail}`} className={link}>
                {STUDIO.privacyEmail}
              </a>{' '}
              and we will remove you by hand.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
