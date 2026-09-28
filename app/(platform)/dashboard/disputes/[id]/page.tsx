'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Send,
  Image as ImageIcon,
  Clock,
  CheckCircle,
  XCircle,
  Search as SearchIcon,
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
  filed_at: string;
  resolved_at: string | null;
  comments: DisputeComment[];
}

const STATUS_VARIANT: Record<DisputeStatus, 'warning' | 'info' | 'success' | 'error' | 'default'> = {
  open: 'warning',
  investigating: 'info',
  resolved: 'success',
  escalated: 'error',
  dismissed: 'default',
};

const STATUS_ICON: Record<DisputeStatus, React.ReactNode> = {
  open: <AlertTriangle className="w-4 h-4" />,
  investigating: <SearchIcon className="w-4 h-4" />,
  resolved: <CheckCircle className="w-4 h-4" />,
  escalated: <AlertTriangle className="w-4 h-4" />,
  dismissed: <XCircle className="w-4 h-4" />,
};

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

export default function DisputeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [dispute, setDispute] = useState<DisputeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchDispute = useCallback(() => {
    fetch(`/api/disputes/${id}`)
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

  const handleSubmitComment = async () => {
    if (!comment.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/disputes/${id}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: comment.trim() }),
      });
      if (res.ok) {
        setComment('');
        fetchDispute();
      }
    } catch {
      // Silent fail
    } finally {
      setSubmitting(false);
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
      className="max-w-3xl"
    >
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-[#D4A843]">{STATUS_ICON[dispute.status]}</span>
          <h2 className="text-lg font-display font-medium uppercase text-white">
            {formatType(dispute.dispute_type)}
          </h2>
          <Badge variant={STATUS_VARIANT[dispute.status]}>{dispute.status}</Badge>
        </div>
        <p className="text-xs text-neutral-400">
          Filed {formatDateTime(dispute.filed_at)}
          {dispute.resolved_at && ` — Resolved ${formatDateTime(dispute.resolved_at)}`}
        </p>
      </div>

      {/* Reason */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 mb-4">
        <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 mb-2">
          Reason
        </h3>
        <p className="text-sm text-neutral-300">{dispute.reason}</p>
        {dispute.evidence_notes && (
          <>
            <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 mb-2 mt-4">
              Additional Notes
            </h3>
            <p className="text-sm text-neutral-300">{dispute.evidence_notes}</p>
          </>
        )}
      </div>

      {/* Evidence Photos */}
      {dispute.evidence_photos && dispute.evidence_photos.length > 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 mb-4">
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 mb-3 flex items-center gap-1.5">
            <ImageIcon className="w-3 h-3" /> Evidence Photos
          </h3>
          <div className="grid grid-cols-3 gap-2">
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

      {/* Resolution */}
      {dispute.resolution && (
        <div className="rounded-xl border border-[#D4A843]/30 bg-[#D4A843]/5 p-4 mb-4">
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-[#D4A843] mb-2">
            Resolution
          </h3>
          <p className="text-sm text-neutral-300">
            {dispute.resolution.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </p>
          {dispute.resolution_amount !== null && dispute.resolution_amount > 0 && (
            <p className="text-sm text-neutral-400 mt-1">
              Amount: R{dispute.resolution_amount.toLocaleString('en-ZA')}
            </p>
          )}
          {dispute.resolution_notes && (
            <p className="text-sm text-neutral-400 mt-2">{dispute.resolution_notes}</p>
          )}
        </div>
      )}

      {/* Timeline / Comments */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 mb-4">
        <h3 className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 mb-4">
          Timeline
        </h3>
        {dispute.comments.length === 0 ? (
          <p className="text-xs text-neutral-400">No comments yet.</p>
        ) : (
          <div className="space-y-4">
            {dispute.comments.map((c) => (
              <div key={c.id} className="border-l-2 border-neutral-700 pl-3">
                <p className="text-[10px] text-neutral-400 flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />
                  {formatDateTime(c.created_at)}
                </p>
                <p className="text-sm text-neutral-300 mt-1">{c.comment}</p>
                {c.attachments && c.attachments.length > 0 && (
                  <div className="flex gap-2 mt-2">
                    {c.attachments.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                        <img
                          src={url}
                          alt={`Attachment ${i + 1}`}
                          className="rounded w-16 h-16 object-cover border border-neutral-700"
                        />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Comment Input */}
      {!isResolved && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a comment..."
            rows={3}
            className="mb-3"
          />
          <Button
            onClick={handleSubmitComment}
            disabled={!comment.trim() || submitting}
            className="flex items-center gap-2"
          >
            <Send className="w-3.5 h-3.5" />
            {submitting ? 'Sending...' : 'Send Comment'}
          </Button>
        </div>
      )}
    </motion.div>
  );
}
