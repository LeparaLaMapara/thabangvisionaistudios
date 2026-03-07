'use client';

import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Upload, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';

type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

interface VerificationData {
  status: VerificationStatus;
  submitted_at?: string;
  verified_at?: string;
  rejection_reason?: string;
}

interface FileSlot {
  label: string;
  key: string;
  file: File | null;
}

export default function VerificationPage() {
  const [verification, setVerification] = useState<VerificationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<FileSlot[]>([
    { label: 'SA ID Document (Front)', key: 'id_front', file: null },
    { label: 'SA ID Document (Back)', key: 'id_back', file: null },
    { label: 'Proof of Address', key: 'proof_of_address', file: null },
  ]);

  useEffect(() => {
    fetchVerification();
  }, []);

  async function fetchVerification() {
    setLoading(true);
    try {
      const res = await fetch('/api/verifications');
      if (res.ok) {
        const data = await res.json();
        setVerification(data);
      } else {
        setVerification({ status: 'unverified' });
      }
    } catch {
      setVerification({ status: 'unverified' });
    }
    setLoading(false);
  }

  const handleFileChange = (index: number, file: File | null) => {
    setFiles((prev) => prev.map((slot, i) => (i === index ? { ...slot, file } : slot)));
  };

  const handleSubmit = async () => {
    const allUploaded = files.every((slot) => slot.file !== null);
    if (!allUploaded) {
      setError('Please upload all required documents.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const formData = new FormData();
      files.forEach((slot) => {
        if (slot.file) {
          formData.append(slot.key, slot.file);
        }
      });

      const res = await fetch('/api/verifications', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to submit documents.');
      }

      await fetchVerification();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed.');
    }

    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-2 text-neutral-500 font-mono text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading...
      </div>
    );
  }

  const status = verification?.status ?? 'unverified';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <h2 className="text-lg font-display font-medium uppercase text-black dark:text-white mb-2">
        Identity Verification
      </h2>
      <p className="text-xs font-mono text-neutral-500 mb-8">
        Verify your identity to list equipment and access marketplace features.
      </p>

      {error && (
        <div className="mb-6 px-4 py-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-700/40 text-red-600 dark:text-red-400 text-xs font-mono">
          {error}
        </div>
      )}

      {/* ── Verified ──────────────────────────────────────────────────────── */}
      {status === 'verified' && (
        <Card className="p-10 text-center">
          <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
          <h3 className="text-sm font-display font-medium uppercase text-black dark:text-white mb-2">
            Identity Verified
          </h3>
          <p className="text-xs font-mono text-neutral-500">
            Your identity has been successfully verified. You have full access to platform features.
          </p>
          {verification?.verified_at && (
            <p className="text-[10px] font-mono text-neutral-400 mt-4">
              Verified on{' '}
              {new Date(verification.verified_at).toLocaleDateString('en-ZA', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          )}
        </Card>
      )}

      {/* ── Pending ───────────────────────────────────────────────────────── */}
      {status === 'pending' && (
        <Card className="p-10 text-center">
          <Clock className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h3 className="text-sm font-display font-medium uppercase text-black dark:text-white mb-2">
            Documents Submitted
          </h3>
          <Badge variant="warning" className="mb-4">
            Under Review
          </Badge>
          <p className="text-xs font-mono text-neutral-500">
            Your documents are currently being reviewed. This typically takes 1-2 business days.
          </p>
          {verification?.submitted_at && (
            <p className="text-[10px] font-mono text-neutral-400 mt-4">
              Submitted on{' '}
              {new Date(verification.submitted_at).toLocaleDateString('en-ZA', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          )}
        </Card>
      )}

      {/* ── Rejected ──────────────────────────────────────────────────────── */}
      {status === 'rejected' && (
        <div>
          <Card className="p-8 mb-8">
            <div className="flex items-start gap-4">
              <XCircle className="w-8 h-8 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-display font-medium uppercase text-black dark:text-white mb-2">
                  Verification Rejected
                </h3>
                {verification?.rejection_reason && (
                  <p className="text-xs font-mono text-neutral-500 mb-2">
                    <span className="text-neutral-400">Reason:</span>{' '}
                    {verification.rejection_reason}
                  </p>
                )}
                <p className="text-xs font-mono text-neutral-500">
                  Please re-upload your documents below to try again.
                </p>
              </div>
            </div>
          </Card>
          <UploadForm
            files={files}
            onFileChange={handleFileChange}
            onSubmit={handleSubmit}
            submitting={submitting}
          />
        </div>
      )}

      {/* ── Unverified ────────────────────────────────────────────────────── */}
      {status === 'unverified' && (
        <UploadForm
          files={files}
          onFileChange={handleFileChange}
          onSubmit={handleSubmit}
          submitting={submitting}
        />
      )}
    </motion.div>
  );
}

/* ── Upload Form ────────────────────────────────────────────────────────────── */

function UploadForm({
  files,
  onFileChange,
  onSubmit,
  submitting,
}: {
  files: FileSlot[];
  onFileChange: (index: number, file: File | null) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <Card className="p-8">
      <h3 className="text-xs font-mono uppercase tracking-widest text-black dark:text-white mb-6">
        Upload Documents
      </h3>
      <div className="space-y-6 mb-8">
        {files.map((slot, index) => (
          <FileDropzone
            key={slot.key}
            label={slot.label}
            file={slot.file}
            onFileChange={(file) => onFileChange(index, file)}
          />
        ))}
      </div>
      <Button onClick={onSubmit} loading={submitting}>
        <Upload className="w-3.5 h-3.5" />
        Submit for Verification
      </Button>
    </Card>
  );
}

/* ── File Dropzone ──────────────────────────────────────────────────────────── */

function FileDropzone({
  label,
  file,
  onFileChange,
}: {
  label: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped && isAcceptedFile(dropped)) {
      onFileChange(dropped);
    }
  };

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected && isAcceptedFile(selected)) {
      onFileChange(selected);
    }
  };

  const isAcceptedFile = (f: File) => {
    const accepted = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    return accepted.includes(f.type);
  };

  return (
    <div>
      <label className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
        {label}
      </label>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={[
          'border-2 border-dashed rounded-sm p-6 text-center cursor-pointer transition-colors',
          file
            ? 'border-emerald-500/30 bg-emerald-500/5'
            : 'border-black/10 dark:border-white/10 hover:border-black/20 dark:hover:border-white/20 bg-neutral-50 dark:bg-neutral-900',
        ].join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={handleSelect}
          className="hidden"
        />
        {file ? (
          <div className="flex items-center justify-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-mono text-emerald-400 truncate max-w-[200px]">
              {file.name}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onFileChange(null);
              }}
              className="text-[10px] font-mono uppercase text-neutral-500 hover:text-red-400 ml-2"
            >
              Remove
            </button>
          </div>
        ) : (
          <div>
            <Upload className="w-5 h-5 text-neutral-400 mx-auto mb-2" />
            <p className="text-[10px] font-mono text-neutral-500">
              Drag & drop or click to upload
            </p>
            <p className="text-[9px] font-mono text-neutral-400 mt-1">
              JPG, PNG, WebP, or PDF
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
