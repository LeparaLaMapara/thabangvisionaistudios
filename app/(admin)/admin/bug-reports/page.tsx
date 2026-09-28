'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Bug, Clock, CheckCircle, XCircle, Copy, MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Modal } from '@/components/ui/Modal';

interface BugReport {
  id: string;
  user_email: string;
  title: string;
  description: string;
  steps_to_reproduce: string | null;
  expected_behaviour: string | null;
  actual_behaviour: string | null;
  page_url: string | null;
  device_info: string | null;
  browser_info: string | null;
  severity: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_BADGE: Record<string, 'warning' | 'info' | 'success' | 'error' | 'default'> = {
  open: 'warning',
  in_progress: 'info',
  resolved: 'success',
  wont_fix: 'default',
  duplicate: 'default',
};

const SEVERITY_BADGE: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
  critical: 'error',
  high: 'warning',
  medium: 'info',
  low: 'default',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  wont_fix: "Won't Fix",
  duplicate: 'Duplicate',
};

export default function AdminBugReportsPage() {
  const [reports, setReports] = useState<BugReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('open');
  const [selectedReport, setSelectedReport] = useState<BugReport | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [updating, setUpdating] = useState(false);

  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/bug-reports');
      const data = await res.json();
      if (data.reports) setReports(data.reports);
    } catch (err) {
      console.error('Failed to fetch reports:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  async function updateReport(id: string, status: string) {
    setUpdating(true);
    try {
      await fetch(`/api/admin/bug-reports/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, admin_notes: adminNotes || undefined }),
      });
      await fetchReports();
      setSelectedReport(null);
      setAdminNotes('');
    } catch (err) {
      console.error('Failed to update report:', err);
    } finally {
      setUpdating(false);
    }
  }

  async function saveNotes(id: string) {
    setUpdating(true);
    try {
      await fetch(`/api/admin/bug-reports/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_notes: adminNotes }),
      });
      await fetchReports();
    } catch (err) {
      console.error('Failed to save notes:', err);
    } finally {
      setUpdating(false);
    }
  }

  const tabs = [
    { id: 'open', label: `Open (${reports.filter((r) => r.status === 'open').length})` },
    { id: 'in_progress', label: `In Progress (${reports.filter((r) => r.status === 'in_progress').length})` },
    { id: 'resolved', label: `Resolved (${reports.filter((r) => r.status === 'resolved').length})` },
    { id: 'all', label: `All (${reports.length})` },
  ];

  const filtered = activeTab === 'all' ? reports : reports.filter((r) => r.status === activeTab);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div className="mb-8">
        <span className="text-[10px] font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-2 block">
          Admin
        </span>
        <h1 className="text-2xl font-display font-medium uppercase text-white">
          Bug Reports
        </h1>
        <p className="text-xs font-mono text-neutral-400 mt-1">
          Review and manage user-submitted bug reports.
        </p>
      </div>

      {/* Tabs */}
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Reports list */}
      <div className="mt-6 space-y-3">
        {filtered.length === 0 ? (
          <EmptyState
            title="No reports"
            description={activeTab === 'all' ? 'No bug reports yet.' : `No ${activeTab.replace('_', ' ')} reports.`}
            icon={<Bug className="w-10 h-10 text-neutral-400" />}
          />
        ) : (
          filtered.map((report) => (
            <button
              key={report.id}
              onClick={() => {
                setSelectedReport(report);
                setAdminNotes(report.admin_notes || '');
              }}
              className="w-full text-left bg-[#0A0A0B] border border-white/5 hover:border-white/15 p-5 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Badge variant={SEVERITY_BADGE[report.severity] || 'default'}>
                      {report.severity}
                    </Badge>
                    <Badge variant={STATUS_BADGE[report.status] || 'default'}>
                      {STATUS_LABELS[report.status] || report.status}
                    </Badge>
                  </div>
                  <h3 className="text-sm font-mono font-bold text-white truncate">
                    {report.title}
                  </h3>
                  <p className="text-xs font-mono text-neutral-400 mt-1 line-clamp-2">
                    {report.description}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px] font-mono text-neutral-400">
                    {new Date(report.created_at).toLocaleDateString()}
                  </p>
                  <p className="text-[10px] font-mono text-neutral-400 mt-0.5">
                    {report.user_email}
                  </p>
                  {report.device_info && (
                    <p className="text-[10px] font-mono text-neutral-400 mt-0.5">
                      {report.device_info}
                    </p>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* Detail Modal */}
      {selectedReport && (
        <Modal
          isOpen={!!selectedReport}
          onClose={() => {
            setSelectedReport(null);
            setAdminNotes('');
          }}
          title={selectedReport.title}
          size="lg"
        >
          <div className="space-y-5">
            {/* Meta */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={SEVERITY_BADGE[selectedReport.severity] || 'default'}>
                {selectedReport.severity}
              </Badge>
              <Badge variant={STATUS_BADGE[selectedReport.status] || 'default'}>
                {STATUS_LABELS[selectedReport.status] || selectedReport.status}
              </Badge>
              <span className="text-[10px] font-mono text-neutral-400">
                {selectedReport.user_email} · {new Date(selectedReport.created_at).toLocaleString()}
              </span>
            </div>

            {/* Description */}
            <div>
              <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-400 mb-1">Description</h4>
              <p className="text-sm font-mono text-neutral-300 whitespace-pre-wrap">{selectedReport.description}</p>
            </div>

            {selectedReport.steps_to_reproduce && (
              <div>
                <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-400 mb-1">Steps to Reproduce</h4>
                <p className="text-sm font-mono text-neutral-300 whitespace-pre-wrap">{selectedReport.steps_to_reproduce}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {selectedReport.expected_behaviour && (
                <div>
                  <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-400 mb-1">Expected</h4>
                  <p className="text-xs font-mono text-neutral-300">{selectedReport.expected_behaviour}</p>
                </div>
              )}
              {selectedReport.actual_behaviour && (
                <div>
                  <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-400 mb-1">Actual</h4>
                  <p className="text-xs font-mono text-neutral-300">{selectedReport.actual_behaviour}</p>
                </div>
              )}
            </div>

            {selectedReport.page_url && (
              <div className="flex items-center gap-2">
                <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-400">Page:</h4>
                <span className="text-xs font-mono text-[#D4A843]">{selectedReport.page_url}</span>
              </div>
            )}

            {/* Device info */}
            <div className="flex items-center gap-4 text-[10px] font-mono text-neutral-400">
              {selectedReport.device_info && <span>Device: {selectedReport.device_info}</span>}
            </div>

            {/* Admin notes */}
            <div>
              <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-400 mb-2">Admin Notes</h4>
              <textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="Internal notes about this report..."
                rows={3}
                className="w-full bg-[#0A0A0B] border border-white/10 px-4 py-3 text-sm font-mono text-white placeholder:text-neutral-400 focus:border-[#D4A843]/50 focus:outline-none transition-colors resize-y"
              />
              <button
                onClick={() => saveNotes(selectedReport.id)}
                disabled={updating}
                className="mt-2 text-[10px] font-mono font-bold uppercase tracking-widest px-4 py-2 border border-white/10 text-white hover:border-white/30 transition-colors disabled:opacity-50"
              >
                <MessageSquare className="w-3 h-3 inline mr-1.5" />
                Save Notes
              </button>
            </div>

            {/* Status actions */}
            <div className="border-t border-white/5 pt-4">
              <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-400 mb-3">Update Status</h4>
              <div className="flex flex-wrap gap-2">
                {selectedReport.status === 'open' && (
                  <>
                    <StatusButton icon={Clock} label="In Progress" onClick={() => updateReport(selectedReport.id, 'in_progress')} disabled={updating} />
                    <StatusButton icon={CheckCircle} label="Resolve" onClick={() => updateReport(selectedReport.id, 'resolved')} disabled={updating} />
                    <StatusButton icon={Copy} label="Duplicate" onClick={() => updateReport(selectedReport.id, 'duplicate')} disabled={updating} />
                    <StatusButton icon={XCircle} label="Won't Fix" onClick={() => updateReport(selectedReport.id, 'wont_fix')} disabled={updating} />
                  </>
                )}
                {selectedReport.status === 'in_progress' && (
                  <>
                    <StatusButton icon={CheckCircle} label="Resolve" onClick={() => updateReport(selectedReport.id, 'resolved')} disabled={updating} />
                    <StatusButton icon={XCircle} label="Won't Fix" onClick={() => updateReport(selectedReport.id, 'wont_fix')} disabled={updating} />
                  </>
                )}
                {(selectedReport.status === 'resolved' || selectedReport.status === 'wont_fix' || selectedReport.status === 'duplicate') && (
                  <StatusButton icon={Bug} label="Reopen" onClick={() => updateReport(selectedReport.id, 'open')} disabled={updating} />
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </motion.div>
  );
}

function StatusButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-widest px-4 py-2 border border-white/10 text-white hover:border-[#D4A843]/50 hover:text-[#D4A843] transition-colors disabled:opacity-50"
    >
      <Icon className="w-3 h-3" />
      {label}
    </button>
  );
}
