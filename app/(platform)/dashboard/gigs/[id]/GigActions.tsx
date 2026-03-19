'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function GigActions({ gigId, status }: { gigId: string; status: string }) {
  const [loading, setLoading] = useState<string | null>(null);
  const router = useRouter();

  async function updateStatus(newStatus: string) {
    setLoading(newStatus);
    try {
      const res = await fetch(`/api/creator-requests/${gigId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        router.refresh();
      }
    } catch {
      // Status update error
    } finally {
      setLoading(null);
    }
  }

  if (status === 'pending') {
    return (
      <div className="flex gap-3 mt-6">
        <button
          onClick={() => updateStatus('confirmed')}
          disabled={loading !== null}
          className="text-[10px] font-mono uppercase tracking-widest px-5 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
        >
          {loading === 'confirmed' ? 'Accepting...' : 'Accept Gig'}
        </button>
        <button
          onClick={() => updateStatus('declined')}
          disabled={loading !== null}
          className="text-[10px] font-mono uppercase tracking-widest px-5 py-2 bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors disabled:opacity-50"
        >
          {loading === 'declined' ? 'Declining...' : 'Decline'}
        </button>
      </div>
    );
  }

  if (status === 'confirmed' || status === 'paid') {
    const nextStatus = status === 'paid' ? 'in_progress' : 'completed';
    const label = status === 'paid' ? 'Start Work' : 'Mark Complete';
    return (
      <div className="mt-6">
        <button
          onClick={() => updateStatus(nextStatus)}
          disabled={loading !== null}
          className="text-[10px] font-mono uppercase tracking-widest px-5 py-2 bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
        >
          {loading ? 'Updating...' : label}
        </button>
      </div>
    );
  }

  if (status === 'in_progress') {
    return (
      <div className="mt-6">
        <button
          onClick={() => updateStatus('completed')}
          disabled={loading !== null}
          className="text-[10px] font-mono uppercase tracking-widest px-5 py-2 bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
        >
          {loading ? 'Completing...' : 'Mark Complete'}
        </button>
      </div>
    );
  }

  return null;
}
