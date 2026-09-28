'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { AlertTriangle, Clock, CheckCircle, XCircle, Search as SearchIcon } from 'lucide-react';
import { Tabs } from '@/components/ui/Tabs';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

type DisputeStatus = 'open' | 'investigating' | 'resolved' | 'escalated' | 'dismissed';

interface Dispute {
  id: string;
  dispute_type: string;
  reason: string;
  status: DisputeStatus;
  resolution: string | null;
  filed_at: string;
  resolved_at: string | null;
  booking_id: string | null;
  equipment_booking_id: string | null;
}

const STATUS_VARIANT: Record<DisputeStatus, 'warning' | 'info' | 'success' | 'error' | 'default'> = {
  open: 'warning',
  investigating: 'info',
  resolved: 'success',
  escalated: 'error',
  dismissed: 'default',
};

const STATUS_ICON: Record<DisputeStatus, React.ReactNode> = {
  open: <AlertTriangle className="w-3.5 h-3.5" />,
  investigating: <SearchIcon className="w-3.5 h-3.5" />,
  resolved: <CheckCircle className="w-3.5 h-3.5" />,
  escalated: <AlertTriangle className="w-3.5 h-3.5" />,
  dismissed: <XCircle className="w-3.5 h-3.5" />,
};

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'resolved', label: 'Resolved' },
];

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function DisputesPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    fetch('/api/disputes')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setDisputes(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <LoadingSpinner label="Loading disputes..." className="py-20" />;
  }

  const filtered = disputes.filter((d) => {
    if (activeTab === 'active') return ['open', 'investigating', 'escalated'].includes(d.status);
    if (activeTab === 'resolved') return ['resolved', 'dismissed'].includes(d.status);
    return true;
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <h2 className="text-lg font-display font-medium uppercase text-white mb-6">
        My Disputes
      </h2>

      <Tabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} className="mb-6" />

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Clock className="w-10 h-10 text-neutral-400" />}
          title="No disputes"
          description="You have no disputes in this category."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((dispute) => (
            <Link
              key={dispute.id}
              href={`/dashboard/disputes/${dispute.id}`}
              className="block rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 hover:border-neutral-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-neutral-400">
                      {STATUS_ICON[dispute.status]}
                    </span>
                    <span className="text-sm font-medium text-white">
                      {formatType(dispute.dispute_type)}
                    </span>
                    <Badge variant={STATUS_VARIANT[dispute.status]}>
                      {dispute.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-neutral-400 truncate">{dispute.reason}</p>
                  <p className="text-[10px] text-neutral-400 mt-1">
                    Filed {formatDate(dispute.filed_at)}
                    {dispute.resolved_at && ` — Resolved ${formatDate(dispute.resolved_at)}`}
                  </p>
                </div>
                {dispute.resolution && (
                  <Badge variant="featured">
                    {dispute.resolution.replace(/_/g, ' ')}
                  </Badge>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </motion.div>
  );
}
