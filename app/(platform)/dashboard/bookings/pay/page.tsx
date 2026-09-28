'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

declare global {
  interface Window {
    PaystackPop?: {
      setup(config: {
        key: string;
        email: string;
        amount: number;
        ref: string;
        currency: string;
        channels: string[];
        onClose: () => void;
        callback: (response: { reference: string }) => void;
      }): { openIframe: () => void };
    };
  }
}

type PayState = 'loading' | 'ready' | 'paying' | 'success' | 'closed' | 'error';

export default function InlinePayPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const ref = searchParams.get('ref');

  const [state, setState] = useState<PayState>(() => ref ? 'loading' : 'error');
  const [errorMsg, setErrorMsg] = useState(() => ref ? '' : 'Missing booking reference.');
  const [booking, setBooking] = useState<{
    reference: string;
    accessCode: string;
    total: number;
    project_category: string;
    duration_hours: number;
    email: string;
  } | null>(null);

  const sdkLoaded = useRef(false);
  const popupOpened = useRef(false);

  // Load Paystack JS SDK
  useEffect(() => {
    if (sdkLoaded.current) return;
    sdkLoaded.current = true;

    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.async = true;
    document.head.appendChild(script);
  }, []);

  // Fetch booking access code
  useEffect(() => {
    if (!ref) return;

    fetch(`/api/service-bookings/pay?ref=${encodeURIComponent(ref)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          if (data.paid) {
            setState('success');
            return;
          }
          throw new Error(data.error || 'Failed to load booking');
        }
        setBooking(data);
        setState('ready');
      })
      .catch((err) => {
        setErrorMsg(err.message);
        setState('error');
      });
  }, [ref]);

  const openPaystack = useCallback(() => {
    if (!booking || !window.PaystackPop || popupOpened.current) return;
    popupOpened.current = true;
    setState('paying');

    const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY;
    if (!publicKey) {
      setErrorMsg('Payment not configured.');
      setState('error');
      return;
    }

    const handler = window.PaystackPop.setup({
      key: publicKey,
      email: booking.email,
      amount: Math.round(booking.total * 100),
      ref: booking.reference,
      currency: 'ZAR',
      channels: ['card', 'bank', 'eft'],
      onClose: () => {
        popupOpened.current = false;
        setState('closed');
      },
      callback: () => {
        popupOpened.current = false;
        setState('success');
      },
    });

    handler.openIframe();
  }, [booking]);

  // Auto-open popup when ready (poll for SDK availability)
  useEffect(() => {
    if (state !== 'ready' || !booking) return;
    // Try immediately, then poll every 200ms for SDK load
    const tryOpen = () => {
      if (window.PaystackPop && !popupOpened.current) {
        openPaystack();
        return true;
      }
      return false;
    };
    if (tryOpen()) return;
    const interval = setInterval(() => {
      if (tryOpen()) clearInterval(interval);
    }, 200);
    return () => clearInterval(interval);
  }, [state, booking, openPaystack]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-md">
        <Link
          href="/dashboard/bookings"
          className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-neutral-400 hover:text-white transition-colors mb-8"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to Bookings
        </Link>

        <div className="border border-white/10 bg-[#0A0A0B] p-8">
          {state === 'loading' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="w-8 h-8 text-[#D4A843] animate-spin" />
              <p className="text-sm font-mono text-neutral-400">Loading booking...</p>
            </div>
          )}

          {(state === 'ready' || state === 'paying') && booking && (
            <div className="flex flex-col items-center gap-4 py-4">
              <Loader2 className="w-8 h-8 text-[#D4A843] animate-spin" />
              <div className="text-center">
                <p className="text-sm font-mono text-white mb-1">
                  {booking.project_category} — {booking.duration_hours}hrs
                </p>
                <p className="text-2xl font-display font-bold text-[#D4A843]">
                  R{booking.total.toLocaleString('en-ZA')}
                </p>
                <p className="text-xs font-mono text-neutral-400 mt-2">
                  Ref: {booking.reference}
                </p>
              </div>
              <p className="text-xs font-mono text-neutral-400 mt-2">
                {state === 'paying' ? 'Complete payment in the popup...' : 'Opening payment...'}
              </p>
            </div>
          )}

          {state === 'success' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <CheckCircle2 className="w-12 h-12 text-emerald-400" />
              <div className="text-center">
                <p className="text-lg font-display font-bold text-white mb-1">Payment Successful</p>
                <p className="text-sm font-mono text-neutral-400">
                  Your booking is confirmed. The creator has been notified.
                </p>
              </div>
              <button
                onClick={() => router.push('/dashboard/bookings')}
                className="mt-4 w-full py-3 text-xs font-mono font-bold uppercase tracking-widest bg-[#D4A843] text-black border border-[#D4A843] hover:opacity-80 transition-all"
              >
                View My Bookings
              </button>
            </div>
          )}

          {state === 'closed' && booking && (
            <div className="flex flex-col items-center gap-4 py-8">
              <XCircle className="w-12 h-12 text-neutral-400" />
              <div className="text-center">
                <p className="text-lg font-display font-bold text-white mb-1">Payment Cancelled</p>
                <p className="text-sm font-mono text-neutral-400">
                  Your booking is still pending. You can retry when ready.
                </p>
              </div>
              <button
                onClick={() => {
                  popupOpened.current = false;
                  openPaystack();
                }}
                className="mt-4 w-full py-3 text-xs font-mono font-bold uppercase tracking-widest bg-[#D4A843] text-black border border-[#D4A843] hover:opacity-80 transition-all"
              >
                Retry Payment
              </button>
            </div>
          )}

          {state === 'error' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <XCircle className="w-12 h-12 text-red-400" />
              <div className="text-center">
                <p className="text-lg font-display font-bold text-white mb-1">Error</p>
                <p className="text-sm font-mono text-neutral-400">{errorMsg}</p>
              </div>
              <button
                onClick={() => router.push('/dashboard/bookings')}
                className="mt-4 w-full py-3 text-xs font-mono font-bold uppercase tracking-widest bg-white/5 text-white border border-white/10 hover:border-white/20 transition-all"
              >
                Back to Bookings
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
