'use client';

import { useEffect, useState } from 'react';

interface Booking {
  id: string;
  reference: string;
  client_id: string;
  client_email: string;
  creator_id: string | null;
  booking_type: string;
  project_category: string;
  project_description: string;
  deliverables: string;
  duration_hours: number;
  location: string | null;
  preferred_dates: string | null;
  subtotal: number;
  vat: number;
  total: number;
  platform_amount: number;
  creator_amount: number;
  payment_status: string;
  payout_status: string;
  status: string;
  client_rating: number | null;
  admin_notes: string | null;
  created_at: string;
  creator: { id: string; display_name: string } | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-400',
  paid: 'bg-blue-500/10 text-blue-400',
  accepted: 'bg-emerald-500/10 text-emerald-400',
  completed: 'bg-green-500/10 text-green-400',
  paid_out: 'bg-purple-500/10 text-purple-400',
  cancelled: 'bg-red-500/10 text-red-400',
  disputed: 'bg-orange-500/10 text-orange-400',
};

const TABS = ['all', 'pending', 'paid', 'accepted', 'completed', 'paid_out', 'cancelled'];

export default function AdminServiceBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/service-bookings')
      .then((r) => r.json())
      .then((data) => setBookings(data.bookings ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = activeTab === 'all' ? bookings : bookings.filter((b) => b.status === activeTab);

  async function handlePayout(bookingId: string) {
    if (!confirm('Trigger payout to creator?')) return;
    setUpdatingId(bookingId);
    try {
      const res = await fetch(`/api/admin/service-bookings/${bookingId}/payout`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        alert(`Payout initiated: ${data.payout_reference}`);
        window.location.reload();
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch { alert('Payout failed'); }
    setUpdatingId(null);
  }

  async function handleCancel(bookingId: string) {
    const reason = prompt('Cancellation reason:');
    if (!reason) return;
    setUpdatingId(bookingId);
    try {
      await fetch(`/api/admin/service-bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', cancellation_reason: reason }),
      });
      window.location.reload();
    } catch { alert('Cancel failed'); }
    setUpdatingId(null);
  }

  async function handleAssign(bookingId: string) {
    const creatorId = prompt('Enter creator UUID to assign:');
    if (!creatorId) return;
    setUpdatingId(bookingId);
    try {
      await fetch(`/api/admin/service-bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creator_id: creatorId }),
      });
      window.location.reload();
    } catch { alert('Assignment failed'); }
    setUpdatingId(null);
  }

  if (loading) {
    return <div className="py-20 text-center text-neutral-500">Loading bookings...</div>;
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-bold text-white">Service Bookings</h1>

      {/* Tabs */}
      <div className="mb-6 flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const count = tab === 'all' ? bookings.length : bookings.filter((b) => b.status === tab).length;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab ? 'bg-[#D4A843] text-black' : 'border border-neutral-700 text-neutral-400 hover:bg-neutral-800'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1).replace('_', ' ')} ({count})
            </button>
          );
        })}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <p className="py-12 text-center text-neutral-500">No bookings found.</p>
      ) : (
        <div className="space-y-4">
          {filtered.map((b) => (
            <div key={b.id} className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-neutral-500">{b.reference}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLORS[b.status] || 'text-neutral-400'}`}>
                      {b.status}
                    </span>
                  </div>
                  <h3 className="mt-1 font-semibold text-white">{b.project_category}</h3>
                  <p className="text-sm text-neutral-400">{b.client_email}</p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-bold text-white">R{b.total.toLocaleString()}</p>
                  <p className="text-neutral-500">Platform: R{b.platform_amount.toLocaleString()}</p>
                  <p className="text-[#D4A843]">Creator: R{b.creator_amount.toLocaleString()}</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-4 text-xs text-neutral-500">
                {b.preferred_dates && <span>Date: {b.preferred_dates}</span>}
                {b.location && <span>Location: {b.location}</span>}
                <span>{b.duration_hours}hrs</span>
                <span>Payment: {b.payment_status}</span>
                <span>Payout: {b.payout_status}</span>
                {b.creator && <span>Creator: {b.creator.display_name}</span>}
              </div>

              <p className="mt-2 text-xs text-neutral-500">{b.project_description}</p>

              {/* Admin actions */}
              <div className="mt-4 flex flex-wrap gap-2">
                {!b.creator_id && b.status === 'paid' && (
                  <button
                    onClick={() => handleAssign(b.id)}
                    disabled={updatingId === b.id}
                    className="rounded-lg border border-blue-600/30 px-3 py-1.5 text-xs text-blue-400 hover:bg-blue-600/10 disabled:opacity-50"
                  >
                    Assign Creator
                  </button>
                )}

                {b.status === 'completed' && b.payout_status === 'pending' && b.creator_id && (
                  <button
                    onClick={() => handlePayout(b.id)}
                    disabled={updatingId === b.id}
                    className="rounded-lg bg-[#D4A843] px-3 py-1.5 text-xs font-medium text-black hover:bg-[#c49a3a] disabled:opacity-50"
                  >
                    Trigger Payout
                  </button>
                )}

                {['paid', 'accepted'].includes(b.status) && (
                  <button
                    onClick={() => handleCancel(b.id)}
                    disabled={updatingId === b.id}
                    className="rounded-lg border border-red-600/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-600/10 disabled:opacity-50"
                  >
                    Cancel + Refund
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
