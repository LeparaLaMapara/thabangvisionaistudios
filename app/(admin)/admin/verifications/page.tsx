'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  ChevronDown,
  ChevronUp,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';

type VerificationStatus = 'pending' | 'verified' | 'rejected';

interface VerificationSubmission {
  user_id: string;
  display_name: string | null;
  email: string | null;
  status: VerificationStatus;
  submitted_at: string;
  verified_at: string | null;
  rejection_reason: string | null;
}

interface DocumentInfo {
  key: string;
  label: string;
  url: string;
  type: 'image' | 'pdf';
}

interface VerificationDetail {
  documents: DocumentInfo[];
}

const STATUS_CONFIG: Record<
  VerificationStatus,
  { label: string; color: string; icon: React.ReactNode }
> = {
  pending: {
    label: 'Pending',
    color: 'text-amber-400 bg-amber-500/10',
    icon: <Clock className="w-3.5 h-3.5" />,
  },
  verified: {
    label: 'Verified',
    color: 'text-emerald-400 bg-emerald-500/10',
    icon: <CheckCircle className="w-3.5 h-3.5" />,
  },
  rejected: {
    label: 'Rejected',
    color: 'text-red-400 bg-red-500/10',
    icon: <XCircle className="w-3.5 h-3.5" />,
  },
};

export default function AdminVerificationsPage() {
  const [submissions, setSubmissions] = useState<VerificationSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VerificationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  useEffect(() => {
    fetchSubmissions();
  }, []);

  async function fetchSubmissions() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/verifications');
      if (!res.ok) throw new Error('Failed to fetch verifications.');
      const data = await res.json();
      setSubmissions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.');
    }
    setLoading(false);
  }

  async function toggleExpand(userId: string) {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      setDetail(null);
      setShowRejectInput(false);
      setRejectReason('');
      return;
    }

    setExpandedUserId(userId);
    setDetail(null);
    setShowRejectInput(false);
    setRejectReason('');
    setDetailLoading(true);

    try {
      const res = await fetch(`/api/admin/verifications/${userId}`);
      if (!res.ok) throw new Error('Failed to fetch details.');
      const data = await res.json();
      setDetail(data);
    } catch {
      setDetail({ documents: [] });
    }

    setDetailLoading(false);
  }

  async function handleAction(userId: string, action: 'approve' | 'reject') {
    if (action === 'reject' && !showRejectInput) {
      setShowRejectInput(true);
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      const body: Record<string, string> = { action };
      if (action === 'reject' && rejectReason.trim()) {
        body.reason = rejectReason.trim();
      }

      const res = await fetch(`/api/admin/verifications/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Action failed.');
      }

      // Refresh data
      setExpandedUserId(null);
      setDetail(null);
      setShowRejectInput(false);
      setRejectReason('');
      await fetchSubmissions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    }

    setActionLoading(false);
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-10">
        <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-600 mb-1">
          Admin
        </p>
        <h1 className="text-2xl font-display font-medium uppercase text-white">
          Identity Verifications
        </h1>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 px-4 py-3 bg-red-950 border border-red-700/40 text-red-400 text-xs font-mono">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-20 gap-2 text-neutral-600 font-mono text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading...
        </div>
      ) : submissions.length === 0 ? (
        <p className="text-neutral-600 font-mono text-sm text-center py-20">
          No verification submissions yet.
        </p>
      ) : (
        <div className="space-y-px">
          {submissions.map((sub) => {
            const config = STATUS_CONFIG[sub.status];
            const isExpanded = expandedUserId === sub.user_id;

            return (
              <motion.div
                key={sub.user_id}
                layout
                className="bg-neutral-900 border border-white/5 hover:border-white/10 transition-colors"
              >
                {/* Row */}
                <button
                  onClick={() => toggleExpand(sub.user_id)}
                  className="w-full flex items-center justify-between gap-4 px-6 py-4 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <p className="text-sm font-mono text-white truncate">
                        {sub.display_name || 'Unknown User'}
                      </p>
                      <span
                        className={`inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 ${config.color}`}
                      >
                        {config.icon}
                        {config.label}
                      </span>
                    </div>
                    <p className="text-[10px] font-mono text-neutral-600">
                      {sub.email || 'No email'}
                      {' / '}
                      Submitted{' '}
                      {new Date(sub.submitted_at).toLocaleDateString('en-ZA', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                  <div className="flex-shrink-0 text-neutral-600">
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </div>
                </button>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="border-t border-white/5 px-6 py-6">
                    {detailLoading ? (
                      <div className="flex items-center gap-2 text-neutral-600 font-mono text-sm py-4">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading documents...
                      </div>
                    ) : (
                      <>
                        {/* Documents */}
                        <h4 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-4">
                          Submitted Documents
                        </h4>
                        {detail && detail.documents.length > 0 ? (
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                            {detail.documents.map((doc) => (
                              <div
                                key={doc.key}
                                className="border border-white/10 p-3"
                              >
                                <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 mb-3">
                                  {doc.label}
                                </p>
                                {doc.type === 'image' ? (
                                  <a
                                    href={doc.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block"
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={doc.url}
                                      alt={doc.label}
                                      className="w-full h-40 object-cover bg-neutral-950"
                                    />
                                  </a>
                                ) : (
                                  <a
                                    href={doc.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 text-xs font-mono text-blue-400 hover:text-blue-300 transition-colors"
                                  >
                                    <FileText className="w-4 h-4" />
                                    View PDF Document
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-neutral-600 font-mono text-xs mb-6">
                            No documents available.
                          </p>
                        )}

                        {/* Rejection reason display */}
                        {sub.status === 'rejected' && sub.rejection_reason && (
                          <div className="mb-6 px-4 py-3 bg-red-950 border border-red-700/40 text-red-400 text-xs font-mono">
                            <span className="text-red-500">Rejection reason:</span>{' '}
                            {sub.rejection_reason}
                          </div>
                        )}

                        {/* Actions */}
                        {sub.status === 'pending' && (
                          <div className="flex items-start gap-3">
                            <button
                              onClick={() => handleAction(sub.user_id, 'approve')}
                              disabled={actionLoading}
                              className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-emerald-500 transition-colors disabled:opacity-50"
                            >
                              {actionLoading && (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              )}
                              <CheckCircle className="w-3 h-3" />
                              Approve
                            </button>

                            <div className="flex flex-col gap-2">
                              <button
                                onClick={() =>
                                  handleAction(sub.user_id, 'reject')
                                }
                                disabled={actionLoading}
                                className="flex items-center gap-2 px-5 py-2 bg-red-600 text-white text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-red-500 transition-colors disabled:opacity-50"
                              >
                                {actionLoading && showRejectInput && (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                )}
                                <XCircle className="w-3 h-3" />
                                Reject
                              </button>
                              {showRejectInput && (
                                <input
                                  type="text"
                                  value={rejectReason}
                                  onChange={(e) =>
                                    setRejectReason(e.target.value)
                                  }
                                  placeholder="Reason for rejection..."
                                  className="bg-neutral-950 border border-white/10 text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-white/30 w-64"
                                />
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
