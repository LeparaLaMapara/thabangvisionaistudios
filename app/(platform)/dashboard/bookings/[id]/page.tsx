'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  AlertTriangle,
  XCircle,
  Flag,
  ArrowRight,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { STUDIO } from '@/lib/constants';
import { formatRand } from '@/lib/format/money';
import type { CancellationQuote } from '@/lib/rental/cancellation';
import type { MoneyView } from '@/lib/rental/money-view';
import { gearNextStep } from '@/lib/rental/next-step';
import { gearStatusLabel } from '@/lib/rental/status-words';
import { GEAR_REPORTABLE_STATUSES } from '@/lib/disputes/report';
import type {
  EquipmentBooking,
  BookingStatus,
} from '@/types/booking';
import { PayPanel, type PaymentInfo } from '@/components/payments/PayPanel';
import { ReportProblemDialog, ReportFiledNote } from '@/components/disputes/ReportProblemDialog';
import { DeliveryPanel } from './DeliveryPanel';

/** Extended booking with optional joined rental fields from the API */
type BookingWithRental = EquipmentBooking & {
  rental_title?: string;
  payment_info?: PaymentInfo | null;
  rental_category?: string;
  fulfilment_method?: string | null;
  requires_manual_approval?: boolean | null;
  payment_method?: string | null;
  /** Payments and refunds (lib/rental/money-view.ts); null when they could not be loaded. */
  money?: MoneyView | null;
};

const cents = (c: number): string => formatRand(c / 100, { decimals: c % 100 !== 0 });
const when = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString(STUDIO.currency.locale, { day: 'numeric', month: 'short', year: 'numeric' }) : '';

const STATUS_VARIANT: Record<BookingStatus, 'default' | 'warning' | 'success' | 'info' | 'error'> = {
  pending: 'warning',
  confirmed: 'info',
  active: 'success',
  overdue: 'error',
  return_pending: 'warning',
  return_reviewed: 'info',
  completed: 'default',
  disputed: 'error',
  cancelled: 'error',
};


export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const paymentStatus = searchParams.get('payment');
  const [booking, setBooking] = useState<BookingWithRental | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportFiled, setReportFiled] = useState(false);
  // What the server said after a cancellation (refund status), or why it refused.
  const [cancelNote, setCancelNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    return fetch(`/api/bookings/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setBooking(data))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  if (loading) {
    return <LoadingSpinner label="Loading booking..." className="py-20" />;
  }

  if (!booking) {
    return (
      <div className="py-12">
        <EmptyState
          title="Booking Not Found"
          description="This booking may not exist or you may not have access to it."
          action={{ label: 'My Bookings', href: '/dashboard/bookings' }}
        />
      </div>
    );
  }

  const startDate = new Date(booking.start_date);
  const endDate = new Date(booking.end_date);
  const dayCount = Math.max(
    1,
    Math.ceil(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    ),
  );
  const canCancel = ['pending', 'confirmed'].includes(booking.status);
  const canReport = GEAR_REPORTABLE_STATUSES.includes(booking.status) && !reportFiled;
  const next = gearNextStep(booking);
  const money = booking.money;

  const handleCancel = async () => {
    // Never ask someone to cancel without telling them what it costs. The
    // server prices it from what was actually paid online (discounts, deposit
    // plan, delivery), so the page shows the server's quote, not its own.
    const quote = (booking as { cancellation?: CancellationQuote | null }).cancellation;
    if (!quote) return;
    const delivery = (booking as { delivery_cancellation?: { refund_cents: number; courier_booked: boolean; too_late: boolean } | null }).delivery_cancellation ?? null;
    if (delivery?.too_late) {
      alert('Your gear is already on its way, so this booking cannot be cancelled online. Please contact us.');
      return;
    }

    const money = (n: number) =>
      `${STUDIO.currency.symbol}${n.toLocaleString(STUDIO.currency.locale)}`;

    const lines = [
      'Cancel this booking?',
      '',
      quote.coolingOff
        ? `You booked less than ${STUDIO.legal.coolingOffDays} days ago and the hire has not started, so everything you paid online is refunded.`
        : quote.refundPercent === 100
          ? `You are cancelling more than 48 hours ahead, so the hire charge is refunded in full.`
          : quote.refundPercent > 0
            ? `You are cancelling ${quote.hoursBefore} hours before the hire starts, so ${quote.refundPercent}% of the hire charge is refunded.`
            : `You are cancelling less than 24 hours before the hire starts, so the hire charge is not refunded.`,
      '',
      `Hire refunded:    ${money(quote.hireRefund)}`,
      `Deposit refunded: ${money(quote.depositRefund)}`,
      ...(quote.deliveryRefund > 0 ? [`Delivery refunded: ${money(quote.deliveryRefund)}`] : []),
      // Phase 4 delivery: refunded per trip, in full unless a courier was
      // already booked (then its cancellation fee, at most the delivery fee).
      ...(delivery && delivery.refund_cents > 0
        ? [`Delivery refunded: ${money(delivery.refund_cents / 100)}${delivery.courier_booked ? ' (less any courier cancellation fee)' : ''}`]
        : []),
      `Total back to you: ${money(quote.totalRefund + (delivery?.refund_cents ?? 0) / 100)}${delivery?.courier_booked ? ' or slightly less' : ''}`,
      '',
      'Refunds go back to the card you paid with.',
    ];

    if (!confirm(lines.join('\n'))) return;
    setCancelling(true);
    setCancelNote(null);
    try {
      const res = await fetch(`/api/bookings/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (res.ok) {
        // The server says what happened to the money; then re-read the booking
        // so Payments and refunds shows the refund and its status.
        setCancelNote({ ok: true, text: body?.message ?? 'Your booking is cancelled.' });
        await load();
      } else {
        setCancelNote({ ok: false, text: body?.error ?? 'We could not cancel just now. Nothing was changed; please try again.' });
      }
    } catch {
      setCancelNote({ ok: false, text: 'We could not reach the server. Nothing was changed; please try again.' });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Back link */}
      <Link
        href="/dashboard/bookings"
        className="inline-flex items-center gap-2 min-h-[44px] text-xs font-mono uppercase tracking-widest text-neutral-400 hover:text-white transition-colors mb-6"
      >
        <ArrowLeft className="w-3 h-3" aria-hidden="true" />
        Back to Bookings
      </Link>

      {/* Payment status banner */}
      {booking.payment_info && <PayPanel info={booking.payment_info} startDate={booking.start_date} />}
      {paymentStatus === 'success' && booking.status === 'pending' && (
        <div className="flex items-center gap-3 p-4 mb-6 bg-[#D4A843]/10 border border-[#D4A843]/20 text-[#D4A843]">
          <Clock className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm font-mono font-bold">Confirming your payment</p>
            <p className="text-xs font-mono text-[#D4A843]/70">We are confirming the payment with the payment provider. Your booking updates once the provider confirms it.</p>
          </div>
        </div>
      )}
      {paymentStatus === 'cancelled' && booking.status === 'pending' && (
        <div className="flex items-center gap-3 p-4 mb-6 bg-red-500/10 border border-red-500/20 text-red-400">
          <XCircle className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm font-mono font-bold">Payment cancelled</p>
            <p className="text-xs font-mono text-red-400/70">Nothing was charged. Your booking is still pending: you can pay again or cancel the booking.</p>
          </div>
        </div>
      )}
      {cancelNote && (
        <div
          role={cancelNote.ok ? 'status' : 'alert'}
          className={`flex items-start gap-3 p-4 mb-6 border ${cancelNote.ok ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}
        >
          {cancelNote.ok ? <CheckCircle2 className="w-5 h-5 flex-shrink-0" aria-hidden="true" /> : <AlertTriangle className="w-5 h-5 flex-shrink-0" aria-hidden="true" />}
          <p className="text-sm font-mono">{cancelNote.text}</p>
        </div>
      )}
      {reportFiled && <ReportFiledNote />}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h2 className="text-lg font-display font-medium uppercase text-white">
              {booking.rental_title ?? `Booking #${booking.id.slice(0, 8)}`}
            </h2>
            <Badge variant={STATUS_VARIANT[booking.status] ?? 'default'}>
              {gearStatusLabel(booking.status)}
            </Badge>
          </div>
          <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">
            Booking #{booking.id.slice(0, 8)} &middot;{' '}
            {booking.rental_category ?? 'Equipment'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canReport && (
            <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => setShowReport(true)}>
              <Flag className="w-3 h-3" aria-hidden="true" />
              Report a problem
            </Button>
          )}
          {canCancel && (
            <Button variant="danger" size="sm" className="min-h-[44px]" loading={cancelling} onClick={handleCancel}>
              <AlertTriangle className="w-3 h-3" aria-hidden="true" />
              Cancel Booking
            </Button>
          )}
        </div>
      </div>

      {/* What happens next: one place that says who acts, and what (if anything) the renter does */}
      {next.lines.length > 0 && (
        <section aria-labelledby="next-step" className="p-4 mb-6 border border-[#D4A843]/30 bg-[#D4A843]/5">
          <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-1">What happens next</p>
          <h3 id="next-step" className="text-sm font-mono font-bold text-white mb-2">{next.title}</h3>
          <ul className="space-y-1 text-xs font-mono text-neutral-300 list-disc pl-5">
            {next.lines.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
        {/* Dates */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-4 h-4 text-neutral-400" aria-hidden="true" />
            <h3 className="text-xs font-mono uppercase tracking-widest text-neutral-400">
              Rental Period
            </h3>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-400 font-mono">Start</span>
              <span className="text-white font-mono">
                {startDate.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-neutral-400 font-mono">End</span>
              <span className="text-white font-mono">
                {endDate.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            </div>
            <div className="flex justify-between text-sm border-t border-white/5 pt-3">
              <span className="text-neutral-400 font-mono">Duration</span>
              <span className="text-white font-mono font-bold">
                {dayCount} day{dayCount > 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </Card>

        {/* Payments and refunds: from the records that hold the money, never assumed */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="w-4 h-4 text-neutral-400" aria-hidden="true" />
            <h3 className="text-xs font-mono uppercase tracking-widest text-neutral-400">
              Payments and refunds
            </h3>
          </div>
          {money === null || money === undefined ? (
            <p className="text-xs font-mono text-neutral-400">
              We could not load your payments just now. Reload the page to try again; nothing about your booking has changed.
            </p>
          ) : (
            <div className="space-y-4">
              {money.charged ? (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm font-mono">
                    <span className="text-white font-bold">
                      Paid{money.charged.at ? ` on ${when(money.charged.at)}` : ''}
                    </span>
                    <span className="text-white font-bold">{cents(money.charged.totalCents)}</span>
                  </div>
                  {money.charged.hireCents !== null && (
                    <div className="flex justify-between text-xs font-mono text-neutral-400">
                      <span>Hire</span>
                      <span>{cents(money.charged.hireCents)}</span>
                    </div>
                  )}
                  {money.charged.depositCents !== null && money.charged.depositCents > 0 && (
                    <div className="flex justify-between text-xs font-mono text-neutral-400">
                      <span>Refundable deposit</span>
                      <span>{cents(money.charged.depositCents)}</span>
                    </div>
                  )}
                  {money.charged.deliveryCents !== null && (
                    <div className="flex justify-between text-xs font-mono text-neutral-400">
                      <span>Delivery</span>
                      <span>{cents(money.charged.deliveryCents)}</span>
                    </div>
                  )}
                  {money.charged.wholeOrder && (
                    <p className="text-xs font-mono text-neutral-400">One payment for your whole order, not only this item.</p>
                  )}
                </div>
              ) : money.awaitingConfirmation ? (
                <p className="text-xs font-mono text-neutral-400">Your payment is being confirmed by the payment provider. It shows here once it is.</p>
              ) : (
                <p className="text-xs font-mono text-neutral-400">Nothing has been charged for this booking.</p>
              )}

              {money.refunds.length > 0 && (
                <ul className="space-y-3 border-t border-white/5 pt-3" aria-label="Refunds">
                  {money.refunds.map((r) => (
                    <li key={r.id} className="space-y-1">
                      <div className="flex justify-between text-sm font-mono">
                        <span className="text-white">{r.label}</span>
                        <span className="text-white">{cents(r.amountCents)}</span>
                      </div>
                      <p className={`text-xs font-mono ${r.stage === 'processed' ? 'text-emerald-400' : r.stage === 'needs_person' ? 'text-[#D4A843]' : 'text-neutral-400'}`}>
                        {r.stageText}
                        {r.wholeOrder ? ' This refund covers your whole order.' : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              {money.charged && (money.charged.depositCents ?? booking.deposit_amount) > 0 && !['cancelled', 'completed'].includes(booking.status) && (
                <p className="text-xs font-mono text-neutral-400 border-t border-white/5 pt-3">
                  The deposit is held until the gear is back and inspected, then refunded to the card you paid with, less any deduction for a late return, damage or a missing item.{' '}
                  <Link href={STUDIO.legal.documents.refunds.href} className="text-[#D4A843] underline underline-offset-2">How deposits work</Link>
                </p>
              )}
              {money.charged && (
                <p className="text-xs font-mono text-neutral-400">Your payment confirmation email is your receipt.</p>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Delivery: verified status, tracking when the provider gives it, return pickup */}
      <DeliveryPanel bookingId={booking.id} />

      {/* Notes */}
      {booking.notes && (
        <Card className="p-6 mb-10">
          <h3 className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-3">
            Notes
          </h3>
          <p className="text-sm text-neutral-400 leading-relaxed whitespace-pre-line">
            {booking.notes}
          </p>
        </Card>
      )}

      {canReport && (
        <p className="text-xs font-mono text-neutral-400">
          Something not right?{' '}
          <button type="button" onClick={() => setShowReport(true)} className="min-h-[44px] inline-flex items-center gap-1 text-[#D4A843] underline underline-offset-2">
            Report a problem <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </button>
        </p>
      )}

      <ReportProblemDialog
        kind="gear"
        bookingId={booking.id}
        isOpen={showReport}
        onClose={() => setShowReport(false)}
        onFiled={() => {
          setShowReport(false);
          setReportFiled(true);
          void load();
        }}
      />
    </motion.div>
  );
}
