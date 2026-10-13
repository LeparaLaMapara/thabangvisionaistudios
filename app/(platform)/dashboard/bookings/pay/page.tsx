'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { isPaymentUrl } from '@/lib/payments/hosts';

type PayState = 'loading' | 'ready' | 'paid' | 'error';

/**
 * Pay (or pay again) for a service booking.
 *
 * The booking's Paystack transaction was started when it was made; this page
 * sends the customer back to that same transaction's hosted payment page
 * (checkout.paystack.com/<access code>). Paystack then returns them to
 * /api/service-bookings/callback, which asks Paystack whether the charge went
 * through and confirms the booking. This page used to open Paystack's popup
 * and call it "Payment Successful" on the popup's word alone, without any
 * check, leaving the booking to the webhook.
 */
export default function PayBookingPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const ref = searchParams.get('ref');

  const [state, setState] = useState<PayState>(() => (ref ? 'loading' : 'error'));
  const [errorMsg, setErrorMsg] = useState(() => (ref ? '' : 'Missing booking reference.'));
  const [booking, setBooking] = useState<{
    reference: string;
    accessCode: string;
    total: number;
    project_category: string;
    duration_hours: number;
  } | null>(null);

  useEffect(() => {
    if (!ref) return;
    fetch(`/api/service-bookings/pay?ref=${encodeURIComponent(ref)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.paid) {
            setState('paid');
            return;
          }
          throw new Error(data.error || 'We could not load this booking.');
        }
        setBooking(data);
        setState('ready');
      })
      .catch((err) => {
        setErrorMsg(err instanceof Error ? err.message : 'We could not load this booking.');
        setState('error');
      });
  }, [ref]);

  const checkoutUrl = booking && /^[A-Za-z0-9]+$/.test(booking.accessCode)
    ? `https://checkout.paystack.com/${booking.accessCode}`
    : null;

  function pay() {
    if (!checkoutUrl || !isPaymentUrl(checkoutUrl)) {
      setErrorMsg('This booking cannot be paid online. Please contact us.');
      setState('error');
      return;
    }
    window.location.href = checkoutUrl;
  }

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

          {state === 'ready' && booking && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="text-center">
                <p className="text-sm font-mono text-white mb-1">
                  {booking.project_category}, {booking.duration_hours} hours
                </p>
                <p className="text-2xl font-display font-bold text-[#D4A843]">
                  R{Number(booking.total).toLocaleString('en-ZA')}
                </p>
                <p className="text-xs font-mono text-neutral-400 mt-2">Ref: {booking.reference}</p>
              </div>
              <p className="text-xs text-neutral-400 text-center">
                You pay on Paystack&rsquo;s secure page, then come straight back here. Nothing is charged until you confirm there.
              </p>
              <button
                onClick={pay}
                className="mt-2 w-full min-h-[44px] py-3 text-xs font-mono font-bold uppercase tracking-widest bg-[#D4A843] text-black border border-[#D4A843] hover:opacity-80 transition-all"
              >
                Pay now
              </button>
            </div>
          )}

          {state === 'paid' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <CheckCircle2 className="w-12 h-12 text-emerald-400" />
              <div className="text-center">
                <p className="text-lg font-display font-bold text-white mb-1">Already paid</p>
                <p className="text-sm font-mono text-neutral-400">This booking is paid. Your creator has been told.</p>
              </div>
              <button
                onClick={() => router.push('/dashboard/bookings')}
                className="mt-4 w-full min-h-[44px] py-3 text-xs font-mono font-bold uppercase tracking-widest bg-[#D4A843] text-black border border-[#D4A843] hover:opacity-80 transition-all"
              >
                View My Bookings
              </button>
            </div>
          )}

          {state === 'error' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <XCircle className="w-12 h-12 text-red-400" />
              <div className="text-center">
                <p className="text-lg font-display font-bold text-white mb-1">Could not open payment</p>
                <p className="text-sm font-mono text-neutral-400">{errorMsg}</p>
              </div>
              <button
                onClick={() => router.push('/dashboard/bookings')}
                className="mt-4 w-full min-h-[44px] py-3 text-xs font-mono font-bold uppercase tracking-widest bg-white/5 text-white border border-white/10 hover:border-white/20 transition-all"
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
