'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  ChevronDown,
  ChevronUp,
  FileText,
  ExternalLink,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Globe,
  Instagram,
  Youtube,
  Linkedin,
  Twitter,
  User,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

type VerificationStatus = 'pending' | 'verified' | 'rejected';
type FilterTab = VerificationStatus | 'all';

interface VerificationRecord {
  id: string;
  display_name: string | null;
  email?: string | null;
  avatar_url: string | null;
  bio: string | null;
  phone: string | null;
  location: string | null;
  skills: string[] | null;
  social_links: Record<string, string> | null;
  is_verified: boolean;
  verification_status: VerificationStatus;
  verification_submitted_at: string | null;
  verification_reviewed_at: string | null;
  verification_rejected_reason: string | null;
  id_front_path: string | null;
  id_back_path: string | null;
  proof_of_address_path: string | null;
  created_at: string | null;
}

interface SignedDocuments {
  idFront: string | null;
  idBack: string | null;
  proofOfAddress: string | null;
}

// ─── Status UI Config ────────────────────────────────────────────────────────

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

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'verified', label: 'Verified' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

// ─── Social link config ─────────────────────────────────────────────────────

const SOCIAL_KEYS: {
  key: string;
  label: string;
  icon: React.ReactNode;
}[] = [
  { key: 'website', label: 'Website', icon: <Globe className="w-3.5 h-3.5" /> },
  { key: 'instagram', label: 'Instagram', icon: <Instagram className="w-3.5 h-3.5" /> },
  { key: 'youtube', label: 'YouTube', icon: <Youtube className="w-3.5 h-3.5" /> },
  { key: 'linkedin', label: 'LinkedIn', icon: <Linkedin className="w-3.5 h-3.5" /> },
  { key: 'twitter', label: 'Twitter', icon: <Twitter className="w-3.5 h-3.5" /> },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function getInitials(name: string | null): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AdminVerificationsPage() {
  const [submissions, setSubmissions] = useState<VerificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>('pending');

  // Expanded row state
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<SignedDocuments | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Action state
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState<string | null>(null);

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/verifications');
      if (!res.ok) throw new Error('Failed to fetch verifications.');
      const data: VerificationRecord[] = await res.json();
      setSubmissions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  // Filter submissions by active tab
  const filtered =
    activeTab === 'all'
      ? submissions
      : submissions.filter((s) => s.verification_status === activeTab);

  // Tab counts
  const counts = {
    pending: submissions.filter((s) => s.verification_status === 'pending').length,
    verified: submissions.filter((s) => s.verification_status === 'verified').length,
    rejected: submissions.filter((s) => s.verification_status === 'rejected').length,
    all: submissions.length,
  };

  // Toggle expand and fetch signed document URLs
  async function toggleExpand(userId: string) {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      setDocuments(null);
      setShowRejectInput(null);
      setRejectReason('');
      return;
    }

    setExpandedUserId(userId);
    setDocuments(null);
    setShowRejectInput(null);
    setRejectReason('');
    setDetailLoading(true);

    try {
      const res = await fetch(`/api/admin/verifications/${userId}`);
      if (!res.ok) throw new Error('Failed to fetch documents.');
      const data = await res.json();
      setDocuments(data.documents ?? data);
    } catch {
      setDocuments({ idFront: null, idBack: null, proofOfAddress: null });
    }

    setDetailLoading(false);
  }

  // Handle approve/reject action
  async function handleAction(userId: string, action: 'approve' | 'reject') {
    if (action === 'reject' && showRejectInput !== userId) {
      setShowRejectInput(userId);
      return;
    }

    if (action === 'reject' && !rejectReason.trim()) {
      setError('Rejection reason is required.');
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      const body: Record<string, string> = { action };
      if (action === 'reject') {
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

      setExpandedUserId(null);
      setDocuments(null);
      setShowRejectInput(null);
      setRejectReason('');
      await fetchSubmissions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    }

    setActionLoading(false);
  }

  return (
    <div className="max-w-6xl mx-auto px-3 md:px-6 py-6 md:py-12">
      {/* Header */}
      <div className="mb-8">
        <p className="text-[9px] font-mono uppercase tracking-[0.3em] text-neutral-600 mb-2">
          Admin
        </p>
        <h1 className="text-2xl font-display font-medium uppercase text-white tracking-wide">
          Identity Verifications
        </h1>
        <div className="w-8 h-px bg-white/20 mt-4" />
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-px mb-6 bg-white/[0.04]">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 sm:flex-none px-5 py-3 text-[10px] font-mono uppercase tracking-widest transition-colors ${
              activeTab === tab.key
                ? 'bg-neutral-800 text-white'
                : 'bg-neutral-900 text-neutral-600 hover:text-neutral-400'
            }`}
          >
            {tab.label}
            {counts[tab.key] > 0 && (
              <span
                className={`ml-2 px-1.5 py-0.5 text-[9px] tabular-nums rounded ${
                  tab.key === 'pending' && counts.pending > 0
                    ? 'bg-amber-500/15 text-amber-400'
                    : 'bg-white/5 text-neutral-500'
                }`}
              >
                {counts[tab.key]}
              </span>
            )}
          </button>
        ))}
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
      ) : filtered.length === 0 ? (
        <div className="bg-neutral-900 border border-white/5 flex items-center justify-center py-20">
          <p className="text-neutral-600 font-mono text-xs uppercase tracking-widest">
            No {activeTab === 'all' ? '' : activeTab} verifications found.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((sub) => {
            const config = STATUS_CONFIG[sub.verification_status];
            const isExpanded = expandedUserId === sub.id;

            return (
              <div
                key={sub.id}
                className="bg-neutral-900 border border-white/5 hover:border-white/10 transition-colors"
              >
                {/* Collapsed Row */}
                <button
                  onClick={() => toggleExpand(sub.id)}
                  className="w-full flex items-center gap-4 px-4 md:px-6 py-4 text-left"
                >
                  {/* Avatar */}
                  <div className="flex-shrink-0">
                    {sub.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={sub.avatar_url}
                        alt={sub.display_name || ''}
                        className="w-10 h-10 rounded-full object-cover bg-neutral-800"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-neutral-800 flex items-center justify-center">
                        <span className="text-[11px] font-mono font-bold text-neutral-500">
                          {getInitials(sub.display_name)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <p className="text-sm font-mono text-white truncate">
                        {sub.display_name || 'Unknown User'}
                      </p>
                      <span
                        className={`inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 flex-shrink-0 ${config.color}`}
                      >
                        {config.icon}
                        {config.label}
                      </span>
                    </div>
                    <p className="text-[10px] font-mono text-neutral-600">
                      {sub.email || 'No email'}
                      {sub.verification_submitted_at && (
                        <>
                          {' / Submitted '}
                          {formatDate(sub.verification_submitted_at)}
                        </>
                      )}
                    </p>
                  </div>

                  {/* Chevron */}
                  <div className="flex-shrink-0 text-neutral-600">
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </div>
                </button>

                {/* ── Expanded Detail ── */}
                {isExpanded && (
                  <div className="border-t border-white/5" onClick={(e) => e.stopPropagation()}>
                    {detailLoading ? (
                      <div className="flex items-center gap-2 text-neutral-600 font-mono text-sm py-10 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading...
                      </div>
                    ) : (
                      <div className="px-4 md:px-6 py-6 space-y-6">

                        {/* ── 1. User Header Section ── */}
                        <div className="flex flex-col md:flex-row gap-6">
                          {/* Avatar large */}
                          <div className="flex-shrink-0">
                            {sub.avatar_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={sub.avatar_url}
                                alt={sub.display_name || ''}
                                className="w-24 h-24 rounded-full object-cover bg-neutral-800"
                              />
                            ) : (
                              <div className="w-24 h-24 rounded-full bg-neutral-800 flex items-center justify-center">
                                <User className="w-8 h-8 text-neutral-600" />
                              </div>
                            )}
                          </div>

                          {/* Profile details */}
                          <div className="flex-1 min-w-0 space-y-3">
                            {/* Name + badge */}
                            <div className="flex items-center gap-3 flex-wrap">
                              <h3 className="text-lg font-mono font-medium text-white">
                                {sub.display_name || 'Unknown User'}
                              </h3>
                              <span
                                className={`inline-flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest px-2.5 py-1 ${config.color}`}
                              >
                                {config.icon}
                                {config.label}
                              </span>
                            </div>

                            {/* Contact info grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                              {/* Email */}
                              {sub.email && (
                                <div className="flex items-center gap-2">
                                  <Mail className="w-3.5 h-3.5 text-neutral-600 flex-shrink-0" />
                                  <a
                                    href={`mailto:${sub.email}`}
                                    className="text-xs font-mono text-neutral-400 hover:text-white transition-colors truncate"
                                  >
                                    {sub.email}
                                  </a>
                                </div>
                              )}

                              {/* Phone */}
                              {sub.phone && (
                                <div className="flex items-center gap-2">
                                  <Phone className="w-3.5 h-3.5 text-neutral-600 flex-shrink-0" />
                                  <a
                                    href={`tel:${sub.phone}`}
                                    className="text-xs font-mono text-neutral-400 hover:text-white transition-colors"
                                  >
                                    {sub.phone}
                                  </a>
                                </div>
                              )}

                              {/* Location */}
                              {sub.location && (
                                <div className="flex items-center gap-2">
                                  <MapPin className="w-3.5 h-3.5 text-neutral-600 flex-shrink-0" />
                                  <span className="text-xs font-mono text-neutral-500">
                                    {sub.location}
                                  </span>
                                </div>
                              )}

                              {/* Member since */}
                              {sub.created_at && (
                                <div className="flex items-center gap-2">
                                  <Calendar className="w-3.5 h-3.5 text-neutral-600 flex-shrink-0" />
                                  <span className="text-xs font-mono text-neutral-500">
                                    Member since {formatDate(sub.created_at)}
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Submitted / Reviewed dates */}
                            <div className="flex items-center gap-4 flex-wrap text-[10px] font-mono text-neutral-700">
                              {sub.verification_submitted_at && (
                                <span>Submitted {formatDate(sub.verification_submitted_at)}</span>
                              )}
                              {sub.verification_reviewed_at && (
                                <span>Reviewed {formatDate(sub.verification_reviewed_at)}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* ── 2. Bio & Skills ── */}
                        {(sub.bio || (sub.skills && sub.skills.length > 0)) && (
                          <div className="border-t border-white/5 pt-5 space-y-3">
                            <SectionLabel>Bio & Skills</SectionLabel>

                            {sub.bio && (
                              <p className="text-sm font-mono text-neutral-400 leading-relaxed max-w-2xl">
                                {sub.bio}
                              </p>
                            )}

                            {sub.skills && sub.skills.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {sub.skills.map((skill) => (
                                  <span
                                    key={skill}
                                    className="px-2.5 py-1 text-[9px] font-mono font-bold uppercase tracking-widest bg-white/5 text-neutral-400 border border-white/5"
                                  >
                                    {skill}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* ── 3. Social Links ── */}
                        {sub.social_links && Object.keys(sub.social_links).length > 0 && (
                          <div className="border-t border-white/5 pt-5 space-y-3">
                            <SectionLabel>Social Links</SectionLabel>
                            <div className="flex flex-wrap gap-3">
                              {SOCIAL_KEYS.map(({ key, label, icon }) => {
                                const url = sub.social_links?.[key];
                                if (!url) return null;
                                return (
                                  <a
                                    key={key}
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 px-3 py-2 bg-neutral-800 border border-white/5 text-xs font-mono text-neutral-400 hover:text-white hover:border-white/15 transition-colors"
                                  >
                                    {icon}
                                    {label}
                                    <ExternalLink className="w-2.5 h-2.5 text-neutral-600" />
                                  </a>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* ── 4. Submitted Documents ── */}
                        <div className="border-t border-white/5 pt-5 space-y-3">
                          <SectionLabel>Submitted Documents</SectionLabel>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <DocumentCard
                              label="SA ID Front"
                              url={documents?.idFront ?? null}
                              path={sub.id_front_path}
                            />
                            <DocumentCard
                              label="SA ID Back"
                              url={documents?.idBack ?? null}
                              path={sub.id_back_path}
                            />
                            <DocumentCard
                              label="Proof of Address"
                              url={documents?.proofOfAddress ?? null}
                              path={sub.proof_of_address_path}
                            />
                          </div>
                        </div>

                        {/* Rejection reason display */}
                        {sub.verification_status === 'rejected' &&
                          sub.verification_rejected_reason && (
                            <div className="px-4 py-3 bg-red-950 border border-red-700/40">
                              <p className="text-[10px] font-mono uppercase tracking-widest text-red-500 mb-1">
                                Rejection Reason
                              </p>
                              <p className="text-xs font-mono text-red-400">
                                {sub.verification_rejected_reason}
                              </p>
                            </div>
                          )}

                        {/* ── 5. Admin Actions ── */}
                        {sub.verification_status === 'pending' && (
                          <div className="border-t border-white/5 pt-5">
                            <SectionLabel>Admin Actions</SectionLabel>
                            <div className="flex items-start gap-3 flex-wrap mt-3">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleAction(sub.id, 'approve'); }}
                                disabled={actionLoading}
                                className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-emerald-500 transition-colors disabled:opacity-50"
                              >
                                {actionLoading && showRejectInput !== sub.id && (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                )}
                                <CheckCircle className="w-3.5 h-3.5" />
                                Approve
                              </button>

                              <div className="flex flex-col gap-2">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleAction(sub.id, 'reject'); }}
                                  disabled={actionLoading}
                                  className="flex items-center gap-2 px-6 py-2.5 bg-red-600 text-white text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-red-500 transition-colors disabled:opacity-50"
                                >
                                  {actionLoading && showRejectInput === sub.id && (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  )}
                                  <XCircle className="w-3.5 h-3.5" />
                                  Reject
                                </button>
                                {showRejectInput === sub.id && (
                                  <textarea
                                    value={rejectReason}
                                    onChange={(e) => setRejectReason(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    placeholder="Reason for rejection (required)..."
                                    rows={2}
                                    className="bg-neutral-950 border border-white/10 text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-white/30 w-full md:w-80 resize-none"
                                  />
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── UI Primitives ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-neutral-600">
      {children}
    </p>
  );
}

function DocumentCard({
  label,
  url,
  path,
}: {
  label: string;
  url: string | null;
  path: string | null;
}) {
  const isPdf = path?.toLowerCase().includes('.pdf') || path?.toLowerCase().includes('pdf');

  if (!path) {
    return (
      <div className="border border-white/5 p-4 flex flex-col items-center justify-center gap-2 min-h-[140px]">
        <FileText className="w-5 h-5 text-neutral-700" />
        <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-700">
          {label}
        </p>
        <p className="text-[9px] font-mono text-neutral-800">Not submitted</p>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="border border-white/5 p-4 flex flex-col items-center justify-center gap-2 min-h-[140px]">
        <FileText className="w-5 h-5 text-neutral-600" />
        <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
          {label}
        </p>
        <p className="text-[9px] font-mono text-neutral-700">URL unavailable</p>
      </div>
    );
  }

  return (
    <div className="border border-white/10 overflow-hidden">
      <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 px-3 py-2 border-b border-white/5">
        {label}
      </p>
      {isPdf ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 py-8 text-xs font-mono text-blue-400 hover:text-blue-300 transition-colors"
        >
          <FileText className="w-5 h-5" />
          View PDF
          <ExternalLink className="w-3 h-3" />
        </a>
      ) : (
        <a href={url} target="_blank" rel="noopener noreferrer" className="block group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={label}
            className="w-full h-36 object-cover bg-neutral-950 group-hover:opacity-80 transition-opacity"
          />
          <div className="flex items-center justify-center gap-1 py-2 text-[9px] font-mono text-neutral-500 group-hover:text-white transition-colors">
            <ExternalLink className="w-2.5 h-2.5" />
            Open full size
          </div>
        </a>
      )}
    </div>
  );
}
