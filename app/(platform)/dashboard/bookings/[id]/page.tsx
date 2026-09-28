'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  CreditCard,
  FileText,
  AlertTriangle,
  XCircle,
  Flag,
  X,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { STUDIO } from '@/lib/constants';
import type { CancellationQuote } from '@/lib/rental/cancellation';
import type {
  EquipmentBooking,
  BookingPayment,
  Invoice,
  BookingStatus,
} from '@/types/booking';
import { PaymentsOfflineNotice } from '@/components/booking/PaymentsOfflineNotice';

/** Extended booking with optional joined rental fields from the API */
type BookingWithRental = EquipmentBooking & {
  rental_title?: string;
  rental_category?: string;
};

const STATUS_VARIANT: Record<BookingStatus, 'default' | 'warning' | 'success' | 'info' | 'error'> = {
  pending: 'warning',
  confirmed: 'info',
  active: 'success',
  completed: 'default',
  cancelled: 'error',
};

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const paymentStatus = searchParams.get('payment');
  const [booking, setBooking] = useState<BookingWithRental | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const [disputeError, setDisputeError] = useState<string | null>(null);
  const [disputeSuccess, setDisputeSuccess] = useState(false);

  useEffect(() => {
    fetch(`/api/bookings/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setBooking(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  // Payment and invoice data will be available once those APIs are built
  const payments: BookingPayment[] = [];
  const invoices: Invoice[] = [];

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
  const canDispute = ['active', 'completed'].includes(booking.status) && !disputeSuccess;

  const handleDisputeSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setDisputeSubmitting(true);
    setDisputeError(null);

    const form = new FormData(e.currentTarget);
    const disputeType = form.get('dispute_type') as string;
    const description = form.get('description') as string;

    if (!disputeType || !description?.trim()) {
      setDisputeError('Please fill in all required fields.');
      setDisputeSubmitting(false);
      return;
    }

    try {
      const res = await fetch('/api/disputes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: booking.id,
          dispute_type: disputeType,
          description: description.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setDisputeError(data?.error ?? 'Failed to submit dispute. Please try again.');
        return;
      }

      setDisputeSuccess(true);
      setShowDisputeModal(false);
    } catch {
      setDisputeError('Network error. Please try again.');
    } finally {
      setDisputeSubmitting(false);
    }
  };

  const handleCancel = async () => {
    // Never ask someone to cancel without telling them what it costs. The
    // server prices it from what was actually paid online (discounts, deposit
    // plan, delivery), so the page shows the server's quote, not its own.
    const quote = (booking as { cancellation?: CancellationQuote | null }).cancellation;
    if (!quote) return;

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
      `Total back to you: ${money(quote.totalRefund)}`,
      '',
      'Refunds go back to the card you paid with.',
    ];

    if (!confirm(lines.join('\n'))) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/bookings/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      if (res.ok) {
        const updated = await res.json();
        setBooking(updated);
      }
    } catch {
      // silently fail
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
        className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-500 hover:text-black dark:hover:text-white transition-colors mb-8"
      >
        <ArrowLeft className="w-3 h-3" />
        Back to Bookings
      </Link>

      {/* Payment status banner */}
      <PaymentsOfflineNotice />
      {paymentStatus === 'success' && (
        <div className="flex items-center gap-3 p-4 mb-6 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <div>
            <p className="text-sm font-mono font-bold">Payment received</p>
            <p className="text-[10px] font-mono text-emerald-400/70">Your booking is being confirmed. This page will update shortly.</p>
          </div>
        </div>
      )}
      {paymentStatus === 'cancelled' && (
        <div className="flex items-center gap-3 p-4 mb-6 bg-red-500/10 border border-red-500/20 text-red-400">
          <XCircle className="w-5 h-5 flex-shrink-0" />
          <div>
            <p className="text-sm font-mono font-bold">Payment cancelled</p>
            <p className="text-[10px] font-mono text-red-400/70">Your booking is still pending. You can retry payment or cancel the booking.</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h2 className="text-lg font-display font-medium uppercase text-black dark:text-white">
              {booking.rental_title ?? `Booking #${booking.id.slice(0, 8)}`}
            </h2>
            <Badge variant={STATUS_VARIANT[booking.status]}>
              {booking.status}
            </Badge>
          </div>
          <p className="text-[9px] font-mono uppercase tracking-widest text-neutral-500">
            Booking #{booking.id.slice(0, 8)} &middot;{' '}
            {booking.rental_category ?? 'Equipment'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canDispute && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDisputeModal(true)}
            >
              <Flag className="w-3 h-3" />
              Report Issue
            </Button>
          )}
          {canCancel && (
            <Button
              variant="danger"
              size="sm"
              loading={cancelling}
              onClick={handleCancel}
            >
              <AlertTriangle className="w-3 h-3" />
              Cancel Booking
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
        {/* Dates */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-4 h-4 text-neutral-400" />
            <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
              Rental Period
            </h3>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-500 font-mono">Start</span>
              <span className="text-black dark:text-white font-mono">
                {startDate.toLocaleDateString('en-ZA', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-neutral-500 font-mono">End</span>
              <span className="text-black dark:text-white font-mono">
                {endDate.toLocaleDateString('en-ZA', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            </div>
            <div className="flex justify-between text-sm border-t border-black/5 dark:border-white/5 pt-3">
              <span className="text-neutral-500 font-mono">Duration</span>
              <span className="text-black dark:text-white font-mono font-bold">
                {dayCount} day{dayCount > 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </Card>

        {/* Pricing */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="w-4 h-4 text-neutral-400" />
            <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
              Payment Summary
            </h3>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-500 font-mono">Rental total</span>
              <span className="text-black dark:text-white font-mono">
                {booking.currency} {booking.total_price.toLocaleString()}
              </span>
            </div>
            {booking.deposit_amount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-neutral-500 font-mono">
                  Refundable deposit
                </span>
                <span className="text-black dark:text-white font-mono">
                  {booking.currency}{' '}
                  {booking.deposit_amount.toLocaleString()}
                </span>
              </div>
            )}
            <div className="flex justify-between text-sm border-t border-black/10 dark:border-white/10 pt-3">
              <span className="text-black dark:text-white font-mono font-bold">
                Total charged
              </span>
              <span className="text-black dark:text-white font-mono font-bold text-lg">
                {booking.currency}{' '}
                {(
                  booking.total_price + booking.deposit_amount
                ).toLocaleString()}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Dispute filed success */}
      {disputeSuccess && (
        <div className="flex items-center gap-3 p-4 mb-6 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <div>
            <p className="text-sm font-mono font-bold">Issue reported</p>
            <p className="text-[10px] font-mono text-emerald-400/70">
              Your dispute has been filed. Our team will review it and get back to you.
            </p>
          </div>
        </div>
      )}

      {/* Notes */}
      {booking.notes && (
        <Card className="p-6 mb-10">
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">
            Notes
          </h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed whitespace-pre-line">
            {booking.notes}
          </p>
        </Card>
      )}

      {/* Payment History */}
      <div className="mb-10">
        <h3 className="text-sm font-bold uppercase tracking-tight mb-4 border-l-2 border-black dark:border-white pl-4">
          Payment History
        </h3>
        {payments.length === 0 ? (
          <EmptyState
            title="No Payments"
            description="Payment records will appear here once processed."
            icon={<CreditCard className="w-6 h-6" />}
          />
        ) : (
          <div className="space-y-3">
            {payments.map((payment) => (
              <Card key={payment.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Badge
                      variant={
                        payment.status === 'succeeded'
                          ? 'success'
                          : payment.status === 'failed'
                            ? 'error'
                            : 'warning'
                      }
                    >
                      {payment.status}
                    </Badge>
                    <p className="text-[9px] font-mono text-neutral-500 mt-1">
                      {new Date(payment.created_at).toLocaleDateString(
                        'en-ZA',
                      )}
                    </p>
                  </div>
                  <span className="font-mono font-bold text-black dark:text-white">
                    {payment.currency} {payment.amount.toLocaleString()}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Invoices */}
      <div>
        <h3 className="text-sm font-bold uppercase tracking-tight mb-4 border-l-2 border-black dark:border-white pl-4">
          Invoices
        </h3>
        {invoices.length === 0 ? (
          <EmptyState
            title="No Invoices"
            description="Invoices will be generated after payment is confirmed."
            icon={<FileText className="w-6 h-6" />}
          />
        ) : (
          <div className="space-y-3">
            {invoices.map((invoice) => (
              <Card key={invoice.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-mono text-black dark:text-white">
                      {invoice.invoice_number}
                    </p>
                    <Badge
                      variant={
                        invoice.status === 'paid'
                          ? 'success'
                          : invoice.status === 'void'
                            ? 'error'
                            : 'warning'
                      }
                    >
                      {invoice.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-mono font-bold text-black dark:text-white">
                      {invoice.currency} {invoice.amount.toLocaleString()}
                    </span>
                    {invoice.pdf_url && (
                      <a
                        href={invoice.pdf_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button variant="ghost" size="sm">
                          <FileText className="w-3 h-3" />
                          PDF
                        </Button>
                      </a>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ── Dispute Modal ── */}
      {showDisputeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-neutral-900 border border-white/10 w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-mono font-bold uppercase tracking-widest text-white">
                Report an Issue
              </h3>
              <button
                onClick={() => { setShowDisputeModal(false); setDisputeError(null); }}
                className="text-neutral-500 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleDisputeSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
                  Issue Type *
                </label>
                <select
                  name="dispute_type"
                  required
                  className="w-full bg-neutral-800 border border-white/10 text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-[#D4A843]/50"
                >
                  <option value="">Select type...</option>
                  <option value="damage">Equipment Damage</option>
                  <option value="late_return">Late Return</option>
                  <option value="missing_item">Missing Item</option>
                  <option value="billing">Billing Issue</option>
                  <option value="quality">Quality Issue</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
                  Description *
                </label>
                <textarea
                  name="description"
                  required
                  rows={4}
                  placeholder="Describe the issue in detail..."
                  className="w-full bg-neutral-800 border border-white/10 text-white text-sm font-mono px-3 py-2 placeholder-neutral-600 focus:outline-none focus:border-[#D4A843]/50 resize-none"
                />
              </div>

              {disputeError && (
                <p className="text-[11px] font-mono text-red-400">{disputeError}</p>
              )}

              <div className="flex items-center gap-3 pt-2">
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  loading={disputeSubmitting}
                >
                  <Flag className="w-3 h-3" />
                  Submit Report
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => { setShowDisputeModal(false); setDisputeError(null); }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </motion.div>
  );
}
