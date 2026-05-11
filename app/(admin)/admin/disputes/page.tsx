'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { AlertTriangle, Search, Clock } from 'lucide-react';
import { Tabs } from '@/components/ui/Tabs';
import { Badge } from '@/components/ui/Badge';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

type DisputeStatus = 'open' | 'investigating' | 'resolved' | 'escalated' | 'dismissed';

interface AdminDispute {
  id: string;
  dispute_type: string;
  filed_by: string;
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

const ITEMS_PER_PAGE = 20;

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

export default function AdminDisputesPage() {
  const [disputes, setDisputes] = useState<AdminDispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab);
    setPage(1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const statusParam = activeTab === 'all' ? '' : `&status=${activeTab}`;
        const res = await fetch(`/api/admin/disputes?page=${page}&limit=${ITEMS_PER_PAGE}${statusParam}`);
        const data = res.ok ? await res.json() : { disputes: [], total: 0, counts: {} };
        if (!cancelled) {
          setDisputes(data.disputes ?? []);
          setTotal(data.total ?? 0);
          setCounts(data.counts ?? {});
        }
      } catch { /* silent */ }
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [activeTab, page]);

  const tabs = [
    { id: 'all', label: `All (${counts.all ?? 0})` },
    { id: 'open', label: `Open (${counts.open ?? 0})` },
    { id: 'investigating', label: `Investigating (${counts.investigating ?? 0})` },
    { id: 'resolved', label: `Resolved (${counts.resolved ?? 0})` },
  ];

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3 mb-6">
        <AlertTriangle className="w-5 h-5 text-[#D4A843]" />
        <h1 className="text-xl font-display font-medium uppercase text-white">
          Dispute Management
        </h1>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={handleTabChange} className="mb-6" />

      {loading ? (
        <LoadingSpinner label="Loading disputes..." className="py-20" />
      ) : disputes.length === 0 ? (
        <EmptyState
          icon={<Clock className="w-10 h-10 text-neutral-600" />}
          title="No disputes"
          description="No disputes found in this category."
        />
      ) : (
        <>
          <div className="space-y-3">
            {disputes.map((dispute) => (
              <Link
                key={dispute.id}
                href={`/admin/disputes/${dispute.id}`}
                className="block rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 hover:border-neutral-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-white">
                        {formatType(dispute.dispute_type)}
                      </span>
                      <Badge variant={STATUS_VARIANT[dispute.status]}>
                        {dispute.status}
                      </Badge>
                      {dispute.booking_id && (
                        <Badge variant="info">Service Booking</Badge>
                      )}
                      {dispute.equipment_booking_id && (
                        <Badge variant="info">Equipment</Badge>
                      )}
                    </div>
                    <p className="text-xs text-neutral-400 truncate">{dispute.reason}</p>
                    <p className="text-[10px] text-neutral-500 mt-1">
                      Filed {formatDate(dispute.filed_at)}
                      {dispute.resolved_at && ` — Resolved ${formatDate(dispute.resolved_at)}`}
                    </p>
                  </div>
                  <Search className="w-4 h-4 text-neutral-600 flex-shrink-0 mt-1" />
                </div>
              </Link>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-6">
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={setPage}
              />
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
