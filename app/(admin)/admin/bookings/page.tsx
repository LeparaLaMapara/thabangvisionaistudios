'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Search, Eye, CheckCircle, XCircle } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Tabs } from '@/components/ui/Tabs';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState } from '@/components/ui/EmptyState';
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

  const handleConfirm = (id: string) => updateBookingStatus(id, 'confirmed');
  const handleCancel = (id: string) => updateBookingStatus(id, 'cancelled');

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
                    <Button variant="ghost" size="sm" title="View details">
                      <Eye className="w-3 h-3" />
                    </Button>
                    {booking.status === 'pending' && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Confirm"
                          onClick={() => handleConfirm(booking.id)}
                        >
                          <CheckCircle className="w-3 h-3 text-emerald-500" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Cancel"
                          onClick={() => handleCancel(booking.id)}
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
    </div>
  );
}
