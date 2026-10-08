'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Calendar, Search, Eye, XCircle, ShieldAlert } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Tabs } from '@/components/ui/Tabs';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { MarkPaid } from '@/components/admin/MarkPaid';
import { formatRand } from '@/lib/format/money';
import type { EquipmentBooking } from '@/types/booking';
import type { BookingStatus as RentalStatus } from '@/lib/core/rental/state';

// ─── Extended booking type with joined rental + user info ────────────────────

type AdminBooking = Omit<EquipmentBooking, 'status'> & {
  status: RentalStatus;
  rental_title: string;
  rental_category: string;
  user_email: string;
  user_name: string | null;
  /** Set by the risk checks; the handover then needs a manager's sign-off. Absent before the migration. */
  requires_manual_approval?: boolean | null;
};

type BadgeVariant = 'default' | 'warning' | 'success' | 'info' | 'error';

const STATUS_VARIANT: Record<RentalStatus, BadgeVariant> = {
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

const statusVariant = (status: string): BadgeVariant => STATUS_VARIANT[status as RentalStatus] ?? 'default';
const statusLabel = (status: string): string => status.replace(/_/g, ' ');

/** Staff may cancel only before the gear leaves (state machine: pending/confirmed → cancelled). */
const CANCELLABLE: readonly string[] = ['pending', 'confirmed'];

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'active', label: 'Active' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'return_pending', label: 'Return pending' },
  { value: 'return_reviewed', label: 'Return reviewed' },
  { value: 'disputed', label: 'Disputed' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
];

const ITEMS_PER_PAGE = 20;

export default function AdminBookingsPage() {
  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [loading, setLoading] = useState(true);

  // Detail modal
  const [detailBooking, setDetailBooking] = useState<AdminBooking | null>(null);

  // Cancel modal: a reason is always required, and a refund amount when paid.
  const [cancelTarget, setCancelTarget] = useState<{
    id: string;
    title: string;
    paid: boolean;
  } | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelRefund, setCancelRefund] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  const openCancel = (b: AdminBooking) => {
    setCancelTarget({ id: b.id, title: b.rental_title, paid: Boolean(b.payfast_payment_id) });
    setCancelReason('');
    setCancelRefund('');
    setCancelError(null);
  };

  const fetchBookings = () => {
    fetch('/api/admin/equipment-bookings')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setBookings(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchBookings();
  }, []);

  const filtered = bookings.filter((b) => {
    if (activeTab !== 'all' && b.status !== activeTab) return false;
    if (statusFilter && b.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !b.rental_title.toLowerCase().includes(q) &&
        !b.user_email.toLowerCase().includes(q) &&
        !(b.user_name ?? '').toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginated = filtered.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE,
  );

  /** PATCH a status change. Returns the server's error message, or null on success. */
  const updateBookingStatus = async (
    id: string,
    body: { status: string; reason: string; refundCents?: number },
  ): Promise<string | null> => {
    try {
      const res = await fetch(`/api/admin/equipment-bookings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return typeof json.error === 'string' ? json.error : 'Could not update the booking.';
      setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, ...json } : b)));
      return null;
    } catch {
      return 'Could not reach the server. Nothing was changed.';
    }
  };

  const refundRand = cancelRefund.trim() === '' ? NaN : Number(cancelRefund);
  const refundValid = !cancelTarget?.paid || (Number.isFinite(refundRand) && refundRand >= 0);
  const cancelReady = cancelReason.trim().length > 0 && refundValid && !cancelLoading;

  const handleCancel = async () => {
    if (!cancelTarget || !cancelReady) return;
    const refundCents = cancelTarget.paid ? Math.round(refundRand * 100) : undefined;
    if (
      cancelTarget.paid &&
      !window.confirm(
        refundCents && refundCents > 0
          ? `Cancel this paid booking and refund ${formatRand(refundRand, { decimals: true })}? A card refund is initiated with the payment provider; an EFT or cash payment must be paid back by hand.`
          : 'Cancel this paid booking with NO refund?',
      )
    ) {
      return;
    }
    setCancelLoading(true);
    setCancelError(null);
    const err = await updateBookingStatus(cancelTarget.id, {
      status: 'cancelled',
      reason: cancelReason.trim(),
      ...(refundCents !== undefined ? { refundCents } : {}),
    });
    setCancelLoading(false);
    if (err) {
      setCancelError(err);
      return;
    }
    setCancelTarget(null);
  };

  if (loading) {
    return <LoadingSpinner label="Loading bookings..." className="py-20" />;
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-display font-medium uppercase text-white mb-1">
              Bookings
            </h1>
            <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">
              {bookings.length} total bookings
            </p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={(id) => {
            setActiveTab(id);
            setPage(1);
          }}
          className="mb-6"
        />

        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-4 mb-8">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by equipment, user email, or name..."
              className="pl-11"
            />
          </div>
          <Select
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="w-48"
          />
        </div>

        {/* Bookings Table */}
        {paginated.length === 0 ? (
          <EmptyState
            title="No Bookings Found"
            description={
              search || statusFilter
                ? 'Try adjusting your search or filters.'
                : 'Bookings will appear here once customers start booking equipment.'
            }
            icon={<Calendar className="w-8 h-8" />}
          />
        ) : (
          <>
            {/* Table header */}
            <div className="hidden md:grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_auto] gap-4 px-5 py-3 text-xs font-mono uppercase tracking-widest text-neutral-400 border-b border-white/10">
              <span>Equipment</span>
              <span>Customer</span>
              <span>Dates</span>
              <span>Total</span>
              <span>Status</span>
              <span>Actions</span>
            </div>

            {/* Rows */}
            <div className="divide-y divide-white/5">
              {paginated.map((booking) => (
                <div
                  key={booking.id}
                  className="grid grid-cols-1 md:grid-cols-[2fr_1.5fr_1fr_1fr_1fr_auto] gap-4 px-5 py-4 items-center hover:bg-white/5 transition-colors"
                >
                  {/* Equipment */}
                  <div>
                    <p className="text-sm font-medium text-white truncate">
                      {booking.rental_title}
                    </p>
                    <p className="text-xs font-mono text-neutral-400 uppercase tracking-widest">
                      {booking.rental_category}
                    </p>
                  </div>

                  {/* Customer */}
                  <div>
                    <p className="text-sm text-white truncate">
                      {booking.user_name ?? 'Unknown'}
                    </p>
                    <p className="text-xs font-mono text-neutral-400 truncate">
                      {booking.user_email}
                    </p>
                  </div>

                  {/* Dates */}
                  <div className="text-xs font-mono text-neutral-400">
                    {new Date(booking.start_date).toLocaleDateString('en-ZA', {
                      day: '2-digit',
                      month: 'short',
                    })}
                    {' — '}
                    {new Date(booking.end_date).toLocaleDateString('en-ZA', {
                      day: '2-digit',
                      month: 'short',
                    })}
                  </div>

                  {/* Total */}
                  <span className="text-sm font-mono font-bold text-white">
                    {booking.currency} {booking.total_price.toLocaleString()}
                  </span>

                  {/* Status */}
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={statusVariant(booking.status)}>
                      {statusLabel(booking.status)}
                    </Badge>
                    {booking.requires_manual_approval && (
                      <Badge variant="featured">Needs risk approval</Badge>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      title="View details"
                      onClick={() => setDetailBooking(booking)}
                    >
                      <Eye className="w-3 h-3" />
                    </Button>
                    {CANCELLABLE.includes(booking.status) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Cancel"
                        aria-label="Cancel booking"
                        onClick={() => openCancel(booking)}
                      >
                        <XCircle className="w-3 h-3 text-red-500" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={setPage}
              className="mt-8"
            />
          </>
        )}
      </motion.div>

      {/* ── Booking Detail Modal ── */}
      <Modal
        isOpen={!!detailBooking}
        onClose={() => setDetailBooking(null)}
        title="Booking Details"
        size="lg"
      >
        {detailBooking && (
          <div className="space-y-6">
            {/* Equipment */}
            <div>
              <h4 className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 mb-2">
                Equipment
              </h4>
              <p className="text-sm font-medium text-white">
                {detailBooking.rental_title}
              </p>
              <p className="text-xs font-mono text-neutral-400 uppercase tracking-widest">
                {detailBooking.rental_category}
              </p>
            </div>

            {/* Customer */}
            <div>
              <h4 className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 mb-2">
                Customer
              </h4>
              <p className="text-sm text-white">
                {detailBooking.user_name ?? 'Unknown'}
              </p>
              <p className="text-xs font-mono text-neutral-400">
                {detailBooking.user_email}
              </p>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 mb-2">
                  Start Date
                </h4>
                <p className="text-sm font-mono text-white">
                  {new Date(detailBooking.start_date).toLocaleDateString('en-ZA', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
              </div>
              <div>
                <h4 className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 mb-2">
                  End Date
                </h4>
                <p className="text-sm font-mono text-white">
                  {new Date(detailBooking.end_date).toLocaleDateString('en-ZA', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
              </div>
            </div>

            {/* Payment */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 mb-2">
                  Total Price
                </h4>
                <p className="text-lg font-mono font-bold text-white">
                  {detailBooking.currency} {detailBooking.total_price.toLocaleString()}
                </p>
              </div>
              <div>
                <h4 className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 mb-2">
                  Deposit
                </h4>
                <p className="text-sm font-mono text-white">
                  {detailBooking.currency} {detailBooking.deposit_amount.toLocaleString()}
                </p>
              </div>
            </div>

            {/* Status */}
            <div>
              <h4 className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 mb-2">
                Status
              </h4>
              <div className="flex flex-wrap gap-2">
                <Badge variant={statusVariant(detailBooking.status)}>
                  {statusLabel(detailBooking.status)}
                </Badge>
                {detailBooking.requires_manual_approval && (
                  <Badge variant="featured">
                    <span className="inline-flex items-center gap-1">
                      <ShieldAlert className="w-3 h-3" aria-hidden="true" /> Needs risk approval
                    </span>
                  </Badge>
                )}
              </div>
              {detailBooking.requires_manual_approval && (
                <p className="text-xs text-neutral-400 mt-2">
                  A manager must approve the risk, with a note, on the handover screen before the gear leaves.
                </p>
              )}
            </div>

            {/* Gateway payment reference */}
            {detailBooking.payfast_payment_id && (
              <div>
                <h4 className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 mb-2">
                  Payment Reference
                </h4>
                <p className="text-xs font-mono text-neutral-400 break-all">
                  {detailBooking.payfast_payment_id}
                </p>
              </div>
            )}

            {/* Notes */}
            {detailBooking.notes && (
              <div>
                <h4 className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 mb-2">
                  Notes
                </h4>
                <p className="text-sm text-neutral-400 leading-relaxed whitespace-pre-wrap">
                  {detailBooking.notes}
                </p>
              </div>
            )}

            {/* Hand over or take back the gear, in person */}
            {detailBooking.status === 'confirmed' && (
              <Link
                href={`/admin/rentals/${detailBooking.id}/handover`}
                className="flex items-center justify-center gap-2 bg-[#D4A843] text-[#050505] py-2.5 text-xs font-mono font-bold uppercase tracking-widest"
              >
                Hand over gear
              </Link>
            )}
            {['active', 'overdue', 'return_pending'].includes(detailBooking.status) && (
              <Link
                href={`/admin/rentals/${detailBooking.id}/return`}
                className="flex items-center justify-center gap-2 border border-white/20 text-white py-2.5 text-xs font-mono font-bold uppercase tracking-widest"
              >
                Take back gear
              </Link>
            )}

            {/* Waiting for payment: record it when it arrives by EFT, cash or a card link */}
            {detailBooking.status === 'pending' && (
              <p className="text-xs text-neutral-400">
                A booking is confirmed only by recording its payment with Mark paid below (or automatically when the card payment
                arrives). There is no plain Confirm, so every confirmed booking has a payment reference.
              </p>
            )}
            {detailBooking.status === 'pending' && (
              <p className="text-xs font-mono text-neutral-400">
                Reference <span className="text-[#D4A843]">{(detailBooking as { payment_reference?: string }).payment_reference}</span>
                {' · '}
                {(detailBooking as { payment_method?: string | null }).payment_method === 'cash' ? 'Paying cash at collection' : 'Paying by EFT'}
              </p>
            )}
            {detailBooking.status === 'pending' && (
              <MarkPaid
                bookingId={detailBooking.id}
                suggestedAmount={
                  (detailBooking as { order_amount_due?: number | null }).order_amount_due ??
                  Number(detailBooking.total_price ?? 0) + Number(detailBooking.deposit_amount ?? 0)
                }
                onDone={() => {
                  setDetailBooking(null);
                  fetchBookings();
                }}
              />
            )}

            {/* Actions */}
            {CANCELLABLE.includes(detailBooking.status) && (
              <div className="flex gap-3 pt-4 border-t border-white/10">
                <button
                  onClick={() => {
                    setDetailBooking(null);
                    openCancel(detailBooking);
                  }}
                  className="flex-1 min-h-[44px] bg-red-600 text-white py-2.5 text-xs font-mono font-bold uppercase tracking-widest hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Cancel Booking
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Cancel Modal ── */}
      <Modal
        isOpen={!!cancelTarget}
        onClose={() => {
          if (!cancelLoading) setCancelTarget(null);
        }}
        title="Cancel Booking"
        size="sm"
      >
        {cancelTarget && (
          <div className="space-y-5">
            <p className="text-sm text-neutral-400 leading-relaxed">
              Cancel the booking for &ldquo;{cancelTarget.title}&rdquo;? This cannot be undone.
            </p>

            <label className="block space-y-1">
              <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                Reason (kept in the booking history)
              </span>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="e.g. Renter failed the ID check at collection"
                className="w-full bg-[#050505] border border-white/10 px-3 py-2 text-sm text-white"
              />
            </label>

            {cancelTarget.paid && (
              <label className="block space-y-1">
                <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                  Refund amount (R) &middot; this booking is paid
                </span>
                <input
                  inputMode="decimal"
                  value={cancelRefund}
                  onChange={(e) => setCancelRefund(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder="0 if nothing is refunded"
                  className="w-full min-h-[44px] bg-[#050505] border border-white/10 px-3 text-sm text-white font-mono"
                />
                <span className="block text-xs text-neutral-400">
                  A card payment is refunded through the payment provider (initiated, not instant). A manual EFT or cash
                  payment is flagged for staff to pay back by hand.
                </span>
              </label>
            )}

            {cancelError && (
              <p role="alert" className="text-sm text-red-400">
                {cancelError}
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setCancelTarget(null)}
                disabled={cancelLoading}
                className="flex-1 min-h-[44px] border border-white/10 text-white py-2.5 text-xs font-mono font-bold uppercase tracking-widest hover:bg-neutral-800 transition-colors disabled:opacity-40"
              >
                Go Back
              </button>
              <button
                onClick={handleCancel}
                disabled={!cancelReady}
                className="flex-1 min-h-[44px] bg-red-600 hover:bg-red-700 text-white py-2.5 text-xs font-mono font-bold uppercase tracking-widest transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {cancelLoading ? (
                  <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  'Cancel Booking'
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
