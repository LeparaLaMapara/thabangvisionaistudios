'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  ChevronDown,
  ChevronUp,
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
  AlertTriangle,
  Shield,
  Smartphone,
  Image as ImageIcon,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

type VerificationStatus = 'pending' | 'verified' | 'rejected';
type FilterTab = VerificationStatus | 'all';

interface PhotoMetadata {
  dateTaken: string | null;
  gps: { latitude: number; longitude: number } | null;
  device: string | null;
  software: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
}

interface FraudFlag {
  severity: 'low' | 'medium' | 'high';
  code: string;
  message: string;
}

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
  selfie_with_id_path: string | null;
  verification_metadata: { id_front: PhotoMetadata; id_back: PhotoMetadata; selfie: PhotoMetadata } | null;
  verification_fraud_flags: FraudFlag[];
  verification_attempts: number;
  verification_ip: string | null;
  verification_user_agent: string | null;
  created_at: string | null;
}

interface SignedDocuments {
  idFront: string | null;
  idBack: string | null;
  selfieWithId: string | null;
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

const SEVERITY_COLORS: Record<string, string> = {
  high: 'text-red-400 bg-red-500/10 border-red-500/20',
  medium: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  low: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
};

const ADMIN_CHECKLIST = [
  'Face in selfie matches face on ID',
  'ID is clearly readable',
  'ID appears valid and not expired',
  'Name on ID matches profile name',
  'No signs of tampering or editing',
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

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
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

  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<SignedDocuments | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [actionLoading, setActionLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [checklist, setChecklist] = useState<boolean[]>(ADMIN_CHECKLIST.map(() => false));

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

  const filtered =
    activeTab === 'all'
      ? submissions
      : submissions.filter((s) => s.verification_status === activeTab);

  const counts = {
    pending: submissions.filter((s) => s.verification_status === 'pending').length,
    verified: submissions.filter((s) => s.verification_status === 'verified').length,
    rejected: submissions.filter((s) => s.verification_status === 'rejected').length,
    all: submissions.length,
  };

  async function toggleExpand(userId: string) {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      setDocuments(null);
      setShowRejectInput(null);
      setRejectReason('');
      setAdminNotes('');
      setChecklist(ADMIN_CHECKLIST.map(() => false));
      return;
    }

    setExpandedUserId(userId);
    setDocuments(null);
    setShowRejectInput(null);
    setRejectReason('');
    setAdminNotes('');
    setChecklist(ADMIN_CHECKLIST.map(() => false));
    setDetailLoading(true);

    try {
      const res = await fetch(`/api/admin/verifications/${userId}`);
      if (!res.ok) throw new Error('Failed to fetch documents.');
      const data = await res.json();
      setDocuments(data.documents ?? data);
    } catch {
      setDocuments({ idFront: null, idBack: null, selfieWithId: null });
    }

    setDetailLoading(false);
  }

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
      if (adminNotes.trim()) {
        body.notes = adminNotes.trim();
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
      setAdminNotes('');
      setChecklist(ADMIN_CHECKLIST.map(() => false));
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
            const flagCount = sub.verification_fraud_flags?.length ?? 0;
            const highFlags = sub.verification_fraud_flags?.filter((f) => f.severity === 'high') ?? [];

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
                      {highFlags.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 flex-shrink-0 text-red-400 bg-red-500/10">
                          <AlertTriangle className="w-3 h-3" />
                          {highFlags.length} flag{highFlags.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] font-mono text-neutral-600">
                      {sub.email || 'No email'}
                      {sub.verification_submitted_at && (
                        <> / Submitted {formatDate(sub.verification_submitted_at)}</>
                      )}
                      {sub.verification_attempts > 0 && (
                        <> / Attempt {sub.verification_attempts} of 3</>
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

                        {/* ── 1. User Info ── */}
                        <div className="flex flex-col md:flex-row gap-6">
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

                          <div className="flex-1 min-w-0 space-y-3">
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

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                              {sub.email && (
                                <div className="flex items-center gap-2">
                                  <Mail className="w-3.5 h-3.5 text-neutral-600 flex-shrink-0" />
                                  <a href={`mailto:${sub.email}`} className="text-xs font-mono text-neutral-400 hover:text-white transition-colors truncate">
                                    {sub.email}
                                  </a>
                                </div>
                              )}
                              {sub.phone && (
                                <div className="flex items-center gap-2">
                                  <Phone className="w-3.5 h-3.5 text-neutral-600 flex-shrink-0" />
                                  <a href={`tel:${sub.phone}`} className="text-xs font-mono text-neutral-400 hover:text-white transition-colors">
                                    {sub.phone}
                                  </a>
                                </div>
                              )}
                              {sub.location && (
                                <div className="flex items-center gap-2">
                                  <MapPin className="w-3.5 h-3.5 text-neutral-600 flex-shrink-0" />
                                  <span className="text-xs font-mono text-neutral-500">{sub.location}</span>
                                </div>
                              )}
                              {sub.created_at && (
                                <div className="flex items-center gap-2">
                                  <Calendar className="w-3.5 h-3.5 text-neutral-600 flex-shrink-0" />
                                  <span className="text-xs font-mono text-neutral-500">
                                    Member since {formatDate(sub.created_at)}
                                  </span>
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-4 flex-wrap text-[10px] font-mono text-neutral-700">
                              {sub.verification_submitted_at && (
                                <span>Submitted {formatDate(sub.verification_submitted_at)}</span>
                              )}
                              {sub.verification_reviewed_at && (
                                <span>Reviewed {formatDate(sub.verification_reviewed_at)}</span>
                              )}
                              <span>Attempt {sub.verification_attempts} of 3</span>
                            </div>
                          </div>
                        </div>

                        {/* ── 2. Bio & Skills ── */}
                        {(sub.bio || (sub.skills && sub.skills.length > 0)) && (
                          <div className="border-t border-white/5 pt-5 space-y-3">
                            <SectionLabel>Bio &amp; Skills</SectionLabel>
                            {sub.bio && (
                              <p className="text-sm font-mono text-neutral-400 leading-relaxed max-w-2xl">{sub.bio}</p>
                            )}
                            {sub.skills && sub.skills.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {sub.skills.map((skill) => (
                                  <span key={skill} className="px-2.5 py-1 text-[9px] font-mono font-bold uppercase tracking-widest bg-white/5 text-neutral-400 border border-white/5">
                                    {skill}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* ── 3. Photo Metadata ── */}
                        {sub.verification_metadata && (
                          <div className="border-t border-white/5 pt-5 space-y-4">
                            <SectionLabel>
                              <Smartphone className="w-3.5 h-3.5 inline mr-1.5" />
                              Photo Metadata
                            </SectionLabel>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <MetadataCard label="Selfie with ID" metadata={sub.verification_metadata.selfie} />
                              <MetadataCard label="ID Front" metadata={sub.verification_metadata.id_front} />
                              <MetadataCard label="ID Back" metadata={sub.verification_metadata.id_back} />
                            </div>

                            {/* Consistency checks */}
                            <ConsistencyChecks metadata={sub.verification_metadata} />
                          </div>
                        )}

                        {/* ── 4. Fraud Flags ── */}
                        <div className="border-t border-white/5 pt-5 space-y-3">
                          <SectionLabel>
                            <Shield className="w-3.5 h-3.5 inline mr-1.5" />
                            Fraud Flags
                          </SectionLabel>
                          {flagCount === 0 ? (
                            <div className="flex items-center gap-2 text-emerald-400 text-xs font-mono">
                              <CheckCircle className="w-3.5 h-3.5" />
                              No flags detected
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {sub.verification_fraud_flags.map((flag, i) => (
                                <div
                                  key={i}
                                  className={`flex items-start gap-2 px-3 py-2 border text-xs font-mono ${SEVERITY_COLORS[flag.severity]}`}
                                >
                                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                                  <div>
                                    <span className="uppercase text-[9px] tracking-widest font-bold mr-2">
                                      {flag.severity}
                                    </span>
                                    {flag.message}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* ── 5. Documents ── */}
                        <div className="border-t border-white/5 pt-5 space-y-3">
                          <SectionLabel>
                            <ImageIcon className="w-3.5 h-3.5 inline mr-1.5" />
                            Submitted Documents
                          </SectionLabel>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <DocumentCard label="SA ID Front" url={documents?.idFront ?? null} path={sub.id_front_path} />
                            <DocumentCard label="SA ID Back" url={documents?.idBack ?? null} path={sub.id_back_path} />
                            <DocumentCard label="Selfie with ID" url={documents?.selfieWithId ?? null} path={sub.selfie_with_id_path} />
                          </div>
                        </div>

                        {/* Rejection reason display */}
                        {sub.verification_status === 'rejected' && sub.verification_rejected_reason && (
                          <div className="px-4 py-3 bg-red-950 border border-red-700/40">
                            <p className="text-[10px] font-mono uppercase tracking-widest text-red-500 mb-1">Rejection Reason</p>
                            <p className="text-xs font-mono text-red-400">{sub.verification_rejected_reason}</p>
                          </div>
                        )}

                        {/* ── 6. Admin Actions (pending only) ── */}
                        {sub.verification_status === 'pending' && (
                          <div className="border-t border-white/5 pt-5 space-y-4">
                            {/* Admin Checklist */}
                            <div>
                              <SectionLabel>Admin Checklist</SectionLabel>
                              <div className="mt-2 space-y-2">
                                {ADMIN_CHECKLIST.map((item, i) => (
                                  <label key={i} className="flex items-center gap-3 cursor-pointer group">
                                    <input
                                      type="checkbox"
                                      checked={checklist[i]}
                                      onChange={(e) => {
                                        const next = [...checklist];
                                        next[i] = e.target.checked;
                                        setChecklist(next);
                                      }}
                                      className="w-3.5 h-3.5 bg-neutral-900 border border-white/20 rounded-sm accent-emerald-500"
                                    />
                                    <span className="text-xs font-mono text-neutral-500 group-hover:text-neutral-300 transition-colors">
                                      {item}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            </div>

                            {/* Admin Notes */}
                            <div>
                              <SectionLabel>Admin Notes</SectionLabel>
                              <textarea
                                value={adminNotes}
                                onChange={(e) => setAdminNotes(e.target.value)}
                                placeholder="Optional notes..."
                                rows={2}
                                className="mt-2 bg-neutral-950 border border-white/10 text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-white/30 w-full resize-none"
                              />
                            </div>

                            {/* Action Buttons */}
                            <div className="flex items-start gap-3 flex-wrap">
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

                            {/* Request metadata */}
                            {(sub.verification_ip || sub.verification_user_agent) && (
                              <div className="text-[9px] font-mono text-neutral-700 space-y-0.5 pt-2">
                                {sub.verification_ip && <p>IP: {sub.verification_ip}</p>}
                                {sub.verification_user_agent && (
                                  <p className="truncate max-w-lg">UA: {sub.verification_user_agent}</p>
                                )}
                              </div>
                            )}
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

// ─── Metadata Card ───────────────────────────────────────────────────────────

function MetadataCard({ label, metadata }: { label: string; metadata: PhotoMetadata }) {
  const hasData = metadata.dateTaken || metadata.device || metadata.gps || metadata.software;

  return (
    <div className="border border-white/5 p-3 space-y-2">
      <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-400">{label}</p>
      {!hasData ? (
        <p className="text-[10px] font-mono text-neutral-700">No EXIF data available</p>
      ) : (
        <div className="space-y-1.5 text-[10px] font-mono">
          {metadata.dateTaken && (
            <div className="flex items-center gap-1.5 text-neutral-400">
              <Calendar className="w-3 h-3 text-neutral-600" />
              {formatDateTime(metadata.dateTaken)}
            </div>
          )}
          {metadata.device && (
            <div className="flex items-center gap-1.5 text-neutral-400">
              <Smartphone className="w-3 h-3 text-neutral-600" />
              {metadata.device}
            </div>
          )}
          {metadata.gps && (
            <div className="flex items-center gap-1.5 text-neutral-400">
              <MapPin className="w-3 h-3 text-neutral-600" />
              <a
                href={`https://www.google.com/maps?q=${metadata.gps.latitude},${metadata.gps.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors"
              >
                {metadata.gps.latitude.toFixed(2)}, {metadata.gps.longitude.toFixed(2)}
                <ExternalLink className="w-2.5 h-2.5 inline ml-1" />
              </a>
            </div>
          )}
          {metadata.software && (
            <div className="flex items-center gap-1.5 text-neutral-400">
              <ImageIcon className="w-3 h-3 text-neutral-600" />
              {metadata.software}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Consistency Checks ──────────────────────────────────────────────────────

function ConsistencyChecks({ metadata }: { metadata: { id_front: PhotoMetadata; id_back: PhotoMetadata; selfie: PhotoMetadata } }) {
  const { id_front, selfie } = metadata;

  const sameDevice = selfie.device && id_front.device ? selfie.device === id_front.device : null;

  const sameLocation =
    selfie.gps && id_front.gps
      ? Math.abs(selfie.gps.latitude - id_front.gps.latitude) < 0.01 &&
        Math.abs(selfie.gps.longitude - id_front.gps.longitude) < 0.01
      : null;

  let timeDiffMinutes: number | null = null;
  if (selfie.dateTaken && id_front.dateTaken) {
    timeDiffMinutes = Math.abs(
      new Date(selfie.dateTaken).getTime() - new Date(id_front.dateTaken).getTime(),
    ) / 60000;
  }

  const isFresh = selfie.dateTaken
    ? Date.now() - new Date(selfie.dateTaken).getTime() < 24 * 60 * 60 * 1000
    : null;

  const noEditingSoftware = !selfie.software || !/photoshop|gimp|canva|picsart|snapseed/i.test(selfie.software);

  return (
    <div className="border border-white/5 p-3">
      <p className="text-[9px] font-mono uppercase tracking-widest text-neutral-600 mb-2">Consistency</p>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px] font-mono">
        <ConsistencyItem label="Same device" value={sameDevice} />
        <ConsistencyItem label="Same location" value={sameLocation} />
        <ConsistencyItem label={`Same time${timeDiffMinutes !== null ? ` (${Math.round(timeDiffMinutes)}m)` : ''}`} value={timeDiffMinutes !== null ? timeDiffMinutes < 5 : null} />
        <ConsistencyItem label="Fresh (<24h)" value={isFresh} />
        <ConsistencyItem label="No edit software" value={noEditingSoftware} />
      </div>
    </div>
  );
}

function ConsistencyItem({ label, value }: { label: string; value: boolean | null }) {
  return (
    <div className="flex items-center gap-1.5">
      {value === null ? (
        <span className="text-neutral-700">—</span>
      ) : value ? (
        <CheckCircle className="w-3 h-3 text-emerald-400" />
      ) : (
        <XCircle className="w-3 h-3 text-red-400" />
      )}
      <span className={value === null ? 'text-neutral-700' : value ? 'text-neutral-400' : 'text-red-400'}>
        {label}
      </span>
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
  if (!path) {
    return (
      <div className="border border-white/5 p-4 flex flex-col items-center justify-center gap-2 min-h-[140px]">
        <ImageIcon className="w-5 h-5 text-neutral-700" />
        <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-700">{label}</p>
        <p className="text-[9px] font-mono text-neutral-800">Not submitted</p>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="border border-white/5 p-4 flex flex-col items-center justify-center gap-2 min-h-[140px]">
        <ImageIcon className="w-5 h-5 text-neutral-600" />
        <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">{label}</p>
        <p className="text-[9px] font-mono text-neutral-700">URL unavailable</p>
      </div>
    );
  }

  return (
    <div className="border border-white/10 overflow-hidden">
      <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 px-3 py-2 border-b border-white/5">
        {label}
      </p>
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
    </div>
  );
}
