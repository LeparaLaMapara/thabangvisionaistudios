'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { Calendar, Eye } from 'lucide-react';
import { Tabs } from '@/components/ui/Tabs';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { EquipmentBooking, BookingStatus } from '@/types/booking';

const STATUS_VARIANT: Record<BookingStatus, 'default' | 'warning' | 'success' | 'info' | 'error'> = {
  pending: 'warning',
  confirmed: 'info',
  active: 'success',
  completed: 'default',
  cancelled: 'error',
};

const TABS = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
  { id: 'cancelled', label: 'Cancelled' },
];

export default function BookingsPage() {
  const [activeTab, setActiveTab] = useState('upcoming');
  const [bookings, setBookings] = useState<EquipmentBooking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/bookings')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setBookings(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
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
      <h2 className="text-lg font-display font-medium uppercase text-black dark:text-white mb-6">
        My Bookings
      </h2>

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
              ? { label: 'Browse Rentals', href: '/smart-rentals' }
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
                      {booking.status}
                    </Badge>
                    <h3 className="text-sm font-medium text-black dark:text-white mt-2">
                      Booking #{booking.id.slice(0, 8)}
                    </h3>
                  </div>
                  <p className="text-sm font-mono font-bold text-black dark:text-white">
                    {booking.currency} {booking.total_price.toLocaleString()}
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-xs font-mono text-neutral-500 flex items-center gap-2">
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
                  <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 flex items-center gap-1">
                    <Eye className="w-3 h-3" />
                    Details
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </motion.div>
  );
}
