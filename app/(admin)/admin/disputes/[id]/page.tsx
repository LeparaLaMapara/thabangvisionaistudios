'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle,
  Image as ImageIcon,
  Send,
  ArrowLeft,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

type DisputeStatus = 'open' | 'investigating' | 'resolved' | 'escalated' | 'dismissed';

interface DisputeComment {
  id: string;
  author_id: string;
  comment: string;
  attachments: string[];
  is_internal: boolean;
  created_at: string;
}

interface DisputeDetail {
  id: string;
  dispute_type: string;
  reason: string;
  status: DisputeStatus;
  resolution: string | null;
  resolution_notes: string | null;
  resolution_amount: number | null;
  evidence_photos: string[];
  evidence_notes: string | null;
  filed_by: string;
  filed_at: string;
  resolved_at: string | null;
  comments: DisputeComment[];
  filer: { id: string; display_name: string | null; email: string | null } | null;
  booking: {
    id: string;
    reference: string;
    client_email: string;
    project_category: string;
    status: string;
    total: number;
    paystack_reference: string | null;
  } | null;
  equipment_booking: {
    id: string;
    user_id: string;
    status: string;
    total_price: number;
    start_date: string;
    end_date: string;
    checkout_photos: string[] | null;
    return_photos: string[] | null;
    condition_at_checkout: string | null;
    condition_at_return: string | null;
    payment_reference: string | null;
  } | null;
}

const STATUS_VARIANT: Record<DisputeStatus, 'warning' | 'info' | 'success' | 'error' | 'default'> = {
  open: 'warning',
  investigating: 'info',
  resolved: 'success',
  escalated: 'error',
  dismissed: 'default',
};

const RESOLUTION_OPTIONS = [
  { value: 'full_refund', label: 'Full Refund' },
  { value: 'partial_refund', label: 'Partial Refund' },
  { value: 'deposit_forfeit', label: 'Deposit Forfeit' },
  { value: 'warning_issued', label: 'Warning Issued' },
  { value: 'user_suspended', label: 'Suspend User' },
  { value: 'no_action', label: 'No Action' },
  { value: 'custom', label: 'Custom Resolution' },
];

const STATUS_OPTIONS: { value: DisputeStatus; label: string }[] = [
  { value: 'investigating', label: 'Investigating' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'dismissed', label: 'Dismissed' },
];

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AdminDisputeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [dispute, setDispute] = useState<DisputeDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Resolution form
  const [selectedStatus, setSelectedStatus] = useState<string>('resolved');
  const [selectedResolution, setSelectedResolution] = useState<string>('no_action');
  const [resolutionAmount, setResolutionAmount] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [resolving, setResolving] = useState(false);

  // Comment form
  const [comment, setComment] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);

  const fetchDispute = useCallback(() => {
    fetch(`/api/admin/disputes/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setDispute(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    fetchDispute();
  }, [fetchDispute]);

  const handleResolve = async () => {
    if (resolving) return;
    setResolving(true);
    try {
      const payload: Record<string, unknown> = {
        status: selectedStatus,
        resolution: selectedResolution,
        resolution_notes: resolutionNotes || undefined,
        internal_notes: internalNotes || undefined,
      };
      if (selectedResolution === 'partial_refund' && resolutionAmount) {
        payload.resolution_amount = parseFloat(resolutionAmount);
      }
      const res = await fetch(`/api/admin/disputes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        fetchDispute();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to resolve dispute.');
      }
    } catch {
      alert('Failed to resolve dispute.');
    } finally {
      setResolving(false);
    }
  };

  const handleSubmitComment = async () => {
    if (!comment.trim() || submittingComment) return;
    setSubmittingComment(true);
    try {
      const res = await fetch(`/api/disputes/${id}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: comment.trim(), is_internal: isInternal }),
      });
      if (res.ok) {
        setComment('');
        setIsInternal(false);
        fetchDispute();
      }
    } catch {
      // Silent fail
    } finally {
      setSubmittingComment(false);
    }
  };

  if (loading) {
    return <LoadingSpinner label="Loading dispute..." className="py-20" />;
  }

  if (!dispute) {
    return (
      <div className="text-center py-20">
        <p className="text-neutral-400">Dispute not found.</p>
      </div>
    );
  }

  const isResolved = ['resolved', 'dismissed'].includes(dispute.status);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Back */}
      <button
        onClick={() => router.push('/admin/disputes')}
        className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white mb-4 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Disputes
      </button>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <AlertTriangle className="w-5 h-5 text-[#D4A843]" />
        <h1 className="text-xl font-display font-medium uppercase text-white">
          {formatType(dispute.dispute_type)}
        </h1>
        <Badge variant={STATUS_VARIANT[dispute.status]}>{dispute.status}</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Details + Timeline */}
        <div className="lg:col-span-2 space-y-4">
          {/* Filer Info */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
            <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
              Filed By
            </h3>
            <p className="text-sm text-white">
              {dispute.filer?.display_name || dispute.filer?.email || 'Unknown'}
            </p>
            <p className="text-xs text-neutral-400 mt-1">
              {formatDateTime(dispute.filed_at)}
            </p>
          </div>

          {/* Reason */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
            <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
              Reason
            </h3>
            <p className="text-sm text-neutral-300">{dispute.reason}</p>
            {dispute.evidence_notes && (
              <>
                <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2 mt-4">
                  Additional Notes
                </h3>
                <p className="text-sm text-neutral-300">{dispute.evidence_notes}</p>
              </>
            )}
          </div>

          {/* Evidence Photos */}
          {dispute.evidence_photos && dispute.evidence_photos.length > 0 && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
              <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3 flex items-center gap-1.5">
                <ImageIcon className="w-3 h-3" /> Evidence Photos
              </h3>
              <div className="grid grid-cols-4 gap-2">
                {dispute.evidence_photos.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={url}
                      alt={`Evidence ${i + 1}`}
                      className="rounded-lg w-full h-24 object-cover border border-neutral-700"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Booking Photos (for gear disputes) */}
          {dispute.equipment_booking && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
              <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">
                Equipment Booking Photos
              </h3>
              <div className="grid grid-cols-2 gap-4">
                {dispute.equipment_booking.checkout_photos && dispute.equipment_booking.checkout_photos.length > 0 && (
                  <div>
                    <p className="text-[10px] font-mono uppercase text-neutral-600 mb-2">Checkout</p>
                    <div className="grid grid-cols-2 gap-1">
                      {dispute.equipment_booking.checkout_photos.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                          <img src={url} alt={`Checkout ${i + 1}`} className="rounded w-full h-20 object-cover border border-neutral-700" />
                        </a>
                      ))}
                    </div>
                    {dispute.equipment_booking.condition_at_checkout && (
                      <p className="text-xs text-neutral-400 mt-1">Condition: {dispute.equipment_booking.condition_at_checkout}</p>
                    )}
                  </div>
                )}
                {dispute.equipment_booking.return_photos && dispute.equipment_booking.return_photos.length > 0 && (
                  <div>
                    <p className="text-[10px] font-mono uppercase text-neutral-600 mb-2">Return</p>
                    <div className="grid grid-cols-2 gap-1">
                      {dispute.equipment_booking.return_photos.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                          <img src={url} alt={`Return ${i + 1}`} className="rounded w-full h-20 object-cover border border-neutral-700" />
                        </a>
                      ))}
                    </div>
                    {dispute.equipment_booking.condition_at_return && (
                      <p className="text-xs text-neutral-400 mt-1">Condition: {dispute.equipment_booking.condition_at_return}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Timeline / Comments */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
            <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-4">
              Timeline
            </h3>
            {dispute.comments.length === 0 ? (
              <p className="text-xs text-neutral-500">No comments yet.</p>
            ) : (
              <div className="space-y-4">
                {dispute.comments.map((c) => (
                  <div
                    key={c.id}
                    className={`border-l-2 pl-3 ${c.is_internal ? 'border-[#D4A843]/50' : 'border-neutral-700'}`}
                  >
                    <p className="text-[10px] text-neutral-500 flex items-center gap-1.5">
                      <Clock className="w-3 h-3" />
                      {formatDateTime(c.created_at)}
                      {c.is_internal && (
                        <Badge variant="featured">Internal</Badge>
                      )}
                    </p>
                    <p className="text-sm text-neutral-300 mt-1">{c.comment}</p>
                    {c.attachments && c.attachments.length > 0 && (
                      <div className="flex gap-2 mt-2">
                        {c.attachments.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                            <img src={url} alt={`Attachment ${i + 1}`} className="rounded w-16 h-16 object-cover border border-neutral-700" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Comment Input */}
            <div className="mt-4 pt-4 border-t border-neutral-800">
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add a comment..."
                rows={2}
                className="mb-2"
              />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-neutral-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isInternal}
                    onChange={(e) => setIsInternal(e.target.checked)}
                    className="rounded border-neutral-600"
                  />
                  Internal note (not visible to users)
                </label>
                <Button
                  onClick={handleSubmitComment}
                  disabled={!comment.trim() || submittingComment}
                  className="flex items-center gap-2 text-xs"
                >
                  <Send className="w-3 h-3" />
                  {submittingComment ? 'Sending...' : 'Send'}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Booking Info + Resolution Form */}
        <div className="space-y-4">
          {/* Booking Info */}
          {dispute.booking && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
              <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
                Service Booking
              </h3>
              <div className="space-y-1.5 text-xs">
                <p className="text-neutral-300">Ref: <span className="text-white font-mono">{dispute.booking.reference}</span></p>
                <p className="text-neutral-300">Category: {dispute.booking.project_category}</p>
                <p className="text-neutral-300">Total: R{dispute.booking.total?.toLocaleString('en-ZA')}</p>
                <p className="text-neutral-300">Status: <Badge variant="default">{dispute.booking.status}</Badge></p>
                <p className="text-neutral-300">Client: {dispute.booking.client_email}</p>
              </div>
            </div>
          )}

          {dispute.equipment_booking && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
              <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
                Equipment Booking
              </h3>
              <div className="space-y-1.5 text-xs">
                <p className="text-neutral-300">Total: R{dispute.equipment_booking.total_price?.toLocaleString('en-ZA')}</p>
                <p className="text-neutral-300">Period: {dispute.equipment_booking.start_date} to {dispute.equipment_booking.end_date}</p>
                <p className="text-neutral-300">Status: <Badge variant="default">{dispute.equipment_booking.status}</Badge></p>
              </div>
            </div>
          )}

          {/* Resolution Form */}
          {!isResolved && (
            <div className="rounded-xl border border-[#D4A843]/30 bg-[#D4A843]/5 p-4">
              <h3 className="text-[10px] font-mono uppercase tracking-widest text-[#D4A843] mb-4 flex items-center gap-1.5">
                <CheckCircle className="w-3 h-3" /> Resolve Dispute
              </h3>

              {/* Status */}
              <div className="mb-3">
                <label className="text-[10px] font-mono uppercase text-neutral-500 block mb-1">
                  Status
                </label>
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="w-full rounded-lg bg-neutral-900 border border-neutral-700 text-sm text-white px-3 py-2"
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Resolution */}
              <div className="mb-3">
                <label className="text-[10px] font-mono uppercase text-neutral-500 block mb-1">
                  Resolution
                </label>
                <div className="space-y-2">
                  {RESOLUTION_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
                      <input
                        type="radio"
                        name="resolution"
                        value={opt.value}
                        checked={selectedResolution === opt.value}
                        onChange={(e) => setSelectedResolution(e.target.value)}
                        className="rounded-full border-neutral-600"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Partial refund amount */}
              {selectedResolution === 'partial_refund' && (
                <div className="mb-3">
                  <label className="text-[10px] font-mono uppercase text-neutral-500 block mb-1">
                    Refund Amount (ZAR)
                  </label>
                  <input
                    type="number"
                    value={resolutionAmount}
                    onChange={(e) => setResolutionAmount(e.target.value)}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="w-full rounded-lg bg-neutral-900 border border-neutral-700 text-sm text-white px-3 py-2"
                  />
                </div>
              )}

              {/* Resolution notes */}
              <div className="mb-3">
                <label className="text-[10px] font-mono uppercase text-neutral-500 block mb-1">
                  Resolution Notes (visible to user)
                </label>
                <Textarea
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  rows={2}
                  placeholder="Explain the resolution..."
                />
              </div>

              {/* Internal notes */}
              <div className="mb-4">
                <label className="text-[10px] font-mono uppercase text-neutral-500 block mb-1">
                  Internal Notes (admin only)
                </label>
                <Textarea
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  rows={2}
                  placeholder="Internal notes..."
                />
              </div>

              <Button
                onClick={handleResolve}
                disabled={resolving}
                className="w-full"
              >
                {resolving ? 'Processing...' : 'Resolve Dispute'}
              </Button>
            </div>
          )}

          {/* Show resolution if already resolved */}
          {isResolved && dispute.resolution && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
              <h3 className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 mb-2 flex items-center gap-1.5">
                <CheckCircle className="w-3 h-3" /> Resolved
              </h3>
              <p className="text-sm text-neutral-300">
                {formatType(dispute.resolution)}
              </p>
              {dispute.resolution_amount !== null && dispute.resolution_amount > 0 && (
                <p className="text-sm text-neutral-400 mt-1">
                  Amount: R{dispute.resolution_amount.toLocaleString('en-ZA')}
                </p>
              )}
              {dispute.resolution_notes && (
                <p className="text-xs text-neutral-400 mt-2">{dispute.resolution_notes}</p>
              )}
              {dispute.resolved_at && (
                <p className="text-[10px] text-neutral-500 mt-2">
                  Resolved {formatDateTime(dispute.resolved_at)}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
