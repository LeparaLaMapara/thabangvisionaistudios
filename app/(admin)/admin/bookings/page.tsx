'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Search, Eye, CheckCircle, XCircle } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Tabs } from '@/components/ui/Tabs';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import type { BookingStatus, EquipmentBooking } from '@/types/booking';

// ─── Extended booking type with joined rental + user info ────────────────────

type AdminBooking = EquipmentBooking & {
  rental_title: string;
  rental_category: string;
  user_email: string;
  user_name: string | null;
};

const STATUS_VARIANT: Record<BookingStatus, 'default' | 'warning' | 'success' | 'info' | 'error'> = {
  pending: 'warning',
  confirmed: 'info',
  active: 'success',
  completed: 'default',
  cancelled: 'error',
};

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
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

  // Confirmation modal
  const [confirmAction, setConfirmAction] = useState<{
    id: string;
    action: 'confirm' | 'cancel';
    title: string;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const fetchBookings = () => {
    fetch('/api/bookings')
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

  const updateBookingStatus = async (id: string, status: string) => {
    try {
      const res = await fetch(`/api/bookings/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const updated = await res.json();
        setBookings((prev) =>
          prev.map((b) => (b.id === id ? { ...b, ...updated } : b)),
        );
      }
    } catch {
      // silently fail
    }
  };

  const handleConfirmAction = useCallback(async () => {
    if (!confirmAction) return;
    setConfirmLoading(true);
    const status = confirmAction.action === 'confirm' ? 'confirmed' : 'cancelled';
    await updateBookingStatus(confirmAction.id, status);
    setConfirmLoading(false);
    setConfirmAction(null);
  }, [confirmAction]);

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
            <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
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
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
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
            <div className="hidden md:grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_auto] gap-4 px-5 py-3 text-[9px] font-mono uppercase tracking-widest text-neutral-600 border-b border-white/10">
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
                    <p className="text-[9px] font-mono text-neutral-600 uppercase tracking-widest">
                      {booking.rental_category}
                    </p>
                  </div>

                  {/* Customer */}
                  <div>
                    <p className="text-sm text-white truncate">
                      {booking.user_name ?? 'Unknown'}
                    </p>
                    <p className="text-[9px] font-mono text-neutral-600 truncate">
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
                  <div>
                    <Badge variant={STATUS_VARIANT[booking.status]}>
                      {booking.status}
                    </Badge>
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
                    {booking.status === 'pending' && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Confirm"
                          onClick={() =>
                            setConfirmAction({
                              id: booking.id,
                              action: 'confirm',
                              title: booking.rental_title,
                            })
                          }
                        >
                          <CheckCircle className="w-3 h-3 text-emerald-500" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Cancel"
                          onClick={() =>
                            setConfirmAction({
                              id: booking.id,
                              action: 'cancel',
                              title: booking.rental_title,
                            })
                          }
                        >
                          <XCircle className="w-3 h-3 text-red-500" />
                        </Button>
                      </>
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
              <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500 mb-2">
                Equipment
              </h4>
              <p className="text-sm font-medium text-black dark:text-white">
                {detailBooking.rental_title}
              </p>
              <p className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
                {detailBooking.rental_category}
              </p>
            </div>

            {/* Customer */}
            <div>
              <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500 mb-2">
                Customer
              </h4>
              <p className="text-sm text-black dark:text-white">
                {detailBooking.user_name ?? 'Unknown'}
              </p>
              <p className="text-xs font-mono text-neutral-500">
                {detailBooking.user_email}
              </p>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500 mb-2">
                  Start Date
                </h4>
                <p className="text-sm font-mono text-black dark:text-white">
                  {new Date(detailBooking.start_date).toLocaleDateString('en-ZA', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
              </div>
              <div>
                <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500 mb-2">
                  End Date
                </h4>
                <p className="text-sm font-mono text-black dark:text-white">
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
                <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500 mb-2">
                  Total Price
                </h4>
                <p className="text-lg font-mono font-bold text-black dark:text-white">
                  {detailBooking.currency} {detailBooking.total_price.toLocaleString()}
                </p>
              </div>
              <div>
                <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500 mb-2">
                  Deposit
                </h4>
                <p className="text-sm font-mono text-black dark:text-white">
                  {detailBooking.currency} {detailBooking.deposit_amount.toLocaleString()}
                </p>
              </div>
            </div>

            {/* Status */}
            <div>
              <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500 mb-2">
                Status
              </h4>
              <Badge variant={STATUS_VARIANT[detailBooking.status]}>
                {detailBooking.status}
              </Badge>
            </div>

            {/* PayFast ID */}
            {detailBooking.payfast_payment_id && (
              <div>
                <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500 mb-2">
                  PayFast Payment ID
                </h4>
                <p className="text-xs font-mono text-neutral-400 break-all">
                  {detailBooking.payfast_payment_id}
                </p>
              </div>
            )}

            {/* Notes */}
            {detailBooking.notes && (
              <div>
                <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500 mb-2">
                  Notes
                </h4>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed whitespace-pre-wrap">
                  {detailBooking.notes}
                </p>
              </div>
            )}

            {/* Actions */}
            {detailBooking.status === 'pending' && (
              <div className="flex gap-3 pt-4 border-t border-black/10 dark:border-white/10">
                <button
                  onClick={() => {
                    setDetailBooking(null);
                    setConfirmAction({
                      id: detailBooking.id,
                      action: 'confirm',
                      title: detailBooking.rental_title,
                    });
                  }}
                  className="flex-1 bg-emerald-600 text-white py-2.5 text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  Confirm Booking
                </button>
                <button
                  onClick={() => {
                    setDetailBooking(null);
                    setConfirmAction({
                      id: detailBooking.id,
                      action: 'cancel',
                      title: detailBooking.rental_title,
                    });
                  }}
                  className="flex-1 bg-red-600 text-white py-2.5 text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Cancel Booking
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Confirmation Modal ── */}
      <Modal
        isOpen={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        title={
          confirmAction?.action === 'confirm'
            ? 'Confirm Booking'
            : 'Cancel Booking'
        }
        size="sm"
      >
        {confirmAction && (
          <div className="space-y-6">
            <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
              {confirmAction.action === 'confirm'
                ? `Are you sure you want to confirm the booking for "${confirmAction.title}"?`
                : `Are you sure you want to cancel the booking for "${confirmAction.title}"? This action cannot be undone.`}
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                disabled={confirmLoading}
                className="flex-1 border border-black/10 dark:border-white/10 text-black dark:text-white py-2.5 text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-40"
              >
                Go Back
              </button>
              <button
                onClick={handleConfirmAction}
                disabled={confirmLoading}
                className={`flex-1 text-white py-2.5 text-[10px] font-mono font-bold uppercase tracking-widest transition-colors disabled:opacity-40 flex items-center justify-center gap-2 ${
                  confirmAction.action === 'confirm'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {confirmLoading ? (
                  <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : confirmAction.action === 'confirm' ? (
                  'Confirm'
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
