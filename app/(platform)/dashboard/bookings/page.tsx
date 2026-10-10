'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { Calendar, Eye } from 'lucide-react';
import { Tabs } from '@/components/ui/Tabs';
import { DashboardSubTabs, ACTIVITY_TABS } from '@/components/dashboard/DashboardSubTabs';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import ServiceBookingsList from './ServiceBookingsList';
import type { EquipmentBooking, BookingStatus } from '@/types/booking';
import { formatRand } from '@/lib/format/money';
import { gearStatusLabel } from '@/lib/rental/status-words';
import { PaymentsOfflineNotice } from '@/components/booking/PaymentsOfflineNotice';
import { CheckoutConfirmation, type OrderLineView } from './CheckoutConfirmation';
import { ConfirmPaymentOnReturn } from './ConfirmPaymentOnReturn';

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

const TABS = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
  { id: 'cancelled', label: 'Cancelled' },
];

export default function BookingsPage() {
  const [activeTab, setActiveTab] = useState('upcoming');
  const [bookingType, setBookingType] = useState<'services' | 'equipment'>('services');
  const [bookings, setBookings] = useState<EquipmentBooking[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [serviceBookings, setServiceBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/bookings').then((r) => r.json()).catch(() => []),
      fetch('/api/service-bookings').then((r) => r.json()).catch(() => ({ bookings: [] })),
    ]).then(([equipData, serviceData]) => {
      if (Array.isArray(equipData)) setBookings(equipData);
      if (serviceData?.bookings) setServiceBookings(serviceData.bookings);
    }).finally(() => setLoading(false));
  }, []);

  // After a gear checkout: show the gear tab, and re-read while the payment is confirmed.
  const showEquipment = useCallback(() => {
    setBookingType('equipment');
    setActiveTab('upcoming');
  }, []);
  const refreshEquipment = useCallback(() => {
    fetch('/api/bookings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data)) setBookings(data);
      })
      .catch(() => undefined);
  }, []);

  if (loading) {
    return <LoadingSpinner label="Loading bookings..." className="py-20" />;
  }

  const filtered = bookings.filter((b) => {
    if (activeTab === 'upcoming')
      return ['pending', 'confirmed', 'active'].includes(b.status);
    if (activeTab === 'past') return b.status === 'completed';
    return b.status === 'cancelled';
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <DashboardSubTabs tabs={ACTIVITY_TABS} />
      <Suspense fallback={null}>
        <PaymentsOfflineNotice />
        <ConfirmPaymentOnReturn onConfirmed={refreshEquipment} />
        <CheckoutConfirmation
          bookings={bookings as unknown as OrderLineView[]}
          onOrder={showEquipment}
          onRefresh={refreshEquipment}
        />
      </Suspense>
      <h2 className="text-lg font-display font-medium uppercase text-white mb-6">
        My Rentals
      </h2>

      {/* Type toggle */}
      <div className="mb-6 flex gap-2">
        <button
          onClick={() => setBookingType('services')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${bookingType === 'services' ? 'bg-[#D4A843] text-black' : 'border border-neutral-700 text-neutral-400 hover:bg-neutral-800'}`}
        >
          Service Bookings ({serviceBookings.length})
        </button>
        <button
          onClick={() => setBookingType('equipment')}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${bookingType === 'equipment' ? 'bg-[#D4A843] text-black' : 'border border-neutral-700 text-neutral-400 hover:bg-neutral-800'}`}
        >
          Equipment Rentals ({bookings.length})
        </button>
      </div>

      {bookingType === 'services' ? (
        <ServiceBookingsList bookings={serviceBookings} />
      ) : (
      <>
      <Tabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} className="mb-8" />

      {filtered.length === 0 ? (
        <EmptyState
          title="No Bookings"
          description={
            activeTab === 'upcoming'
              ? 'You have no upcoming equipment bookings. Browse our rental catalog to get started.'
              : 'No bookings found in this category.'
          }
          action={
            activeTab === 'upcoming'
              ? { label: 'Browse Rentals', href: '/rentals' }
              : undefined
          }
          icon={<Calendar className="w-8 h-8" />}
        />
      ) : (
        <div className="space-y-4">
          {filtered.map((booking) => (
            <Link key={booking.id} href={`/dashboard/bookings/${booking.id}`}>
              <Card hover className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <Badge variant={STATUS_VARIANT[booking.status]}>
                      {gearStatusLabel(booking.status)}
                    </Badge>
                    <h3 className="text-sm font-medium text-white mt-2">
                      {(booking as { rental_title?: string | null }).rental_title ?? `Booking #${booking.id.slice(0, 8)}`}
                    </h3>
                  </div>
                  <p className="text-sm font-mono font-bold text-white text-right">
                    <span className="block text-xs font-normal text-neutral-400">Hire</span>
                    {formatRand(Number(booking.total_price))}
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-xs font-mono text-neutral-400 flex items-center gap-2">
                    <Calendar className="w-3 h-3" />
                    {new Date(booking.start_date).toLocaleDateString('en-ZA', {
                      day: 'numeric',
                      month: 'short',
                    })}{' '}
                    &mdash;{' '}
                    {new Date(booking.end_date).toLocaleDateString('en-ZA', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                  <span className="text-xs font-mono uppercase tracking-widest text-neutral-400 flex items-center gap-1">
                    <Eye className="w-3 h-3" />
                    Details
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
      )}
    </motion.div>
  );
}
