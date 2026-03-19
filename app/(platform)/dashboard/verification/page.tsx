'use client';

import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Upload,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  ShieldCheck,
  Camera,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { STUDIO } from '@/lib/constants';

type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

interface VerificationData {
  verification_status: VerificationStatus;
  verification_submitted_at: string | null;
  verification_reviewed_at: string | null;
  verification_rejected_reason: string | null;
  verification_attempts: number;
}

interface FileSlot {
  label: string;
  description: string;
  key: string;
  capture: 'environment' | 'user';
  file: File | null;
  preview: string | null;
}

const REVIEW_DAYS = STUDIO.verification.reviewDays;
const MAX_ATTEMPTS = 3;

function validateImage(file: File): { valid: boolean; error?: string } {
  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    return { valid: false, error: 'Only JPG and PNG files allowed.' };
  }
  if (file.size < 50 * 1024) {
    return { valid: false, error: 'Photo file is too small (under 50KB). Please take a higher resolution photo.' };
  }
  const maxSize = (STUDIO.verification.maxFileSizeMB ?? 5) * 1024 * 1024;
  if (file.size > maxSize) {
    return { valid: false, error: `Photo is too large. Maximum ${STUDIO.verification.maxFileSizeMB}MB.` };
  }
  return { valid: true };
}

export default function VerificationPage() {
  const [verification, setVerification] = useState<VerificationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [files, setFiles] = useState<FileSlot[]>([
    {
      label: 'SA ID Smart Card (Front)',
      description: 'Take a clear photo of the front of your SA ID Smart Card. Good lighting, flat surface, all text readable.',
      key: 'id_front',
      capture: 'environment',
      file: null,
      preview: null,
    },
    {
      label: 'SA ID Smart Card (Back)',
      description: 'Take a clear photo of the back of your SA ID Smart Card.',
      key: 'id_back',
      capture: 'environment',
      file: null,
      preview: null,
    },
    {
      label: 'Selfie with your ID',
      description: 'Hold your ID next to your face and take a photo. We need to see both your face and your ID clearly.',
      key: 'selfie_with_id',
      capture: 'user',
      file: null,
      preview: null,
    },
  ]);

  useEffect(() => {
    fetchVerification();
  }, []);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      files.forEach((slot) => {
        if (slot.preview) URL.revokeObjectURL(slot.preview);
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchVerification() {
    setLoading(true);
    try {
      const res = await fetch('/api/verifications');
      if (res.ok) {
        const data = await res.json();
        setVerification(data);
      } else {
        setVerification({
          verification_status: 'unverified',
          verification_submitted_at: null,
          verification_reviewed_at: null,
          verification_rejected_reason: null,
          verification_attempts: 0,
        });
      }
    } catch {
      setVerification({
        verification_status: 'unverified',
        verification_submitted_at: null,
        verification_reviewed_at: null,
        verification_rejected_reason: null,
        verification_attempts: 0,
      });
    }
    setLoading(false);
  }

  const handleFileChange = (index: number, file: File | null) => {
    setFiles((prev) =>
      prev.map((slot, i) => {
        if (i !== index) return slot;
        // Revoke old preview URL
        if (slot.preview) URL.revokeObjectURL(slot.preview);
        return {
          ...slot,
          file,
          preview: file ? URL.createObjectURL(file) : null,
        };
      }),
    );
    setError(null);
  };

  const handleSubmit = async () => {
    const allUploaded = files.every((slot) => slot.file !== null);
    if (!allUploaded) {
      setError('Please upload all three photos.');
      return;
    }

    if (!confirmed) {
      setError('Please confirm that the photos are real.');
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
      formData.append('confirmed', 'true');

      const res = await fetch('/api/verifications', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to submit documents.');
      }

      setJustSubmitted(true);
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

  const status = verification?.verification_status ?? 'unverified';
  const attempts = verification?.verification_attempts ?? 0;
  const maxReached = attempts >= MAX_ATTEMPTS;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <h2 className="text-lg font-display font-medium uppercase text-white mb-2">
        Identity Verification
      </h2>
      <p className="text-xs font-mono text-neutral-500 mb-8">
        Get verified to list equipment and join our crew.
      </p>

      {error && (
        <div className="mb-6 px-4 py-3 bg-red-950 border border-red-700/40 text-red-400 text-xs font-mono flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Success banner after fresh submission */}
      {justSubmitted && status === 'pending' && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 px-5 py-4 bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-3"
        >
          <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-mono font-medium text-emerald-400">
              Documents submitted successfully.
            </p>
            <p className="text-xs font-mono text-emerald-400/70 mt-1">
              We&apos;ll review your verification within {REVIEW_DAYS}.
            </p>
          </div>
        </motion.div>
      )}

      {/* ── Verified ────────────────────────────────────────────────── */}
      {status === 'verified' && (
        <Card className="p-10 text-center">
          <ShieldCheck className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
          <div className="flex justify-center mb-4">
            <Badge variant="success">
              <CheckCircle className="w-3 h-3" />
              Verified
            </Badge>
          </div>
          <h3 className="text-sm font-display font-medium uppercase text-white mb-2">
            Identity Verified
          </h3>
          <p className="text-xs font-mono text-neutral-500">
            Your identity has been successfully verified. You have full access to platform features.
          </p>
          {verification?.verification_reviewed_at && (
            <p className="text-[10px] font-mono text-neutral-400 mt-4">
              Verified on{' '}
              {new Date(verification.verification_reviewed_at).toLocaleDateString('en-ZA', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          )}
        </Card>
      )}

      {/* ── Pending ─────────────────────────────────────────────────── */}
      {status === 'pending' && (
        <Card className="p-10 text-center">
          <Clock className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h3 className="text-sm font-display font-medium uppercase text-white mb-2">
            Documents Under Review
          </h3>
          <Badge variant="warning" className="mb-4">
            Pending Review
          </Badge>
          <p className="text-xs font-mono text-neutral-500">
            Your documents are under review. We&apos;ll notify you within {REVIEW_DAYS}.
          </p>
          {verification?.verification_submitted_at && (
            <p className="text-[10px] font-mono text-neutral-400 mt-4">
              Submitted on{' '}
              {new Date(verification.verification_submitted_at).toLocaleDateString('en-ZA', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          )}
          <div className="mt-6">
            <Button disabled>
              Submitted — Under Review
            </Button>
          </div>
        </Card>
      )}

      {/* ── Rejected ────────────────────────────────────────────────── */}
      {status === 'rejected' && (
        <div>
          <Card className="p-8 mb-8">
            <div className="flex items-start gap-4">
              <XCircle className="w-8 h-8 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-display font-medium uppercase text-white mb-2">
                  Verification Rejected
                </h3>
                {verification?.verification_rejected_reason && (
                  <p className="text-xs font-mono text-neutral-500 mb-2">
                    <span className="text-neutral-400">Reason:</span>{' '}
                    {verification.verification_rejected_reason}
                  </p>
                )}
                {maxReached ? (
                  <p className="text-xs font-mono text-red-400">
                    Maximum attempts reached. Contact support at {STUDIO.supportEmail}
                  </p>
                ) : (
                  <p className="text-xs font-mono text-neutral-500">
                    Please re-upload your documents below to try again.
                    <span className="text-neutral-600 ml-2">
                      (Attempt {attempts} of {MAX_ATTEMPTS})
                    </span>
                  </p>
                )}
              </div>
            </div>
          </Card>
          {!maxReached && (
            <UploadForm
              files={files}
              confirmed={confirmed}
              onConfirmedChange={setConfirmed}
              onFileChange={handleFileChange}
              onSubmit={handleSubmit}
              submitting={submitting}
            />
          )}
        </div>
      )}

      {/* ── Unverified ──────────────────────────────────────────────── */}
      {status === 'unverified' && (
        <UploadForm
          files={files}
          confirmed={confirmed}
          onConfirmedChange={setConfirmed}
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
  confirmed,
  onConfirmedChange,
  onFileChange,
  onSubmit,
  submitting,
}: {
  files: FileSlot[];
  confirmed: boolean;
  onConfirmedChange: (v: boolean) => void;
  onFileChange: (index: number, file: File | null) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <Card className="p-8">
      <h3 className="text-xs font-mono uppercase tracking-widest text-white mb-1">
        Verify Your Identity
      </h3>
      <p className="text-[10px] font-mono text-neutral-600 mb-8">
        Upload a photo of your SA ID (front &amp; back) and a selfie holding your ID.
      </p>

      <div className="space-y-8 mb-8">
        {files.map((slot, index) => (
          <div key={slot.key}>
            {/* Step indicator */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-neutral-600 bg-white/5 px-2 py-0.5">
                Step {index + 1} of {files.length}
              </span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-white">
                {slot.label}
              </span>
            </div>

            <p className="text-[10px] font-mono text-neutral-500 mb-3">
              {slot.description}
            </p>

            {/* Selfie guide */}
            {slot.key === 'selfie_with_id' && (
              <div className="mb-3 p-4 bg-white/[0.02] border border-white/5">
                <p className="text-[9px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
                  How to take this photo
                </p>
                <div className="flex items-center gap-4 text-[10px] font-mono text-neutral-400">
                  <span>Your face</span>
                  <span className="text-neutral-600">+</span>
                  <span>Your ID card visible</span>
                  <span className="text-neutral-600">=</span>
                  <span className="text-emerald-400">Both clearly in frame</span>
                </div>
              </div>
            )}

            <PhotoDropzone
              slot={slot}
              onFileChange={(file) => onFileChange(index, file)}
            />
          </div>
        ))}
      </div>

      {/* Confirmation checkbox */}
      <label className="flex items-start gap-3 mb-6 cursor-pointer group">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirmedChange(e.target.checked)}
          className="mt-0.5 w-4 h-4 bg-neutral-900 border border-white/20 rounded-sm accent-emerald-500"
        />
        <span className="text-xs font-mono text-neutral-400 group-hover:text-neutral-300 transition-colors">
          I confirm this is my real SA ID and the selfie is of me.
        </span>
      </label>

      <Button onClick={onSubmit} loading={submitting}>
        <Upload className="w-3.5 h-3.5" />
        Submit for Verification
      </Button>
    </Card>
  );
}

/* ── Photo Dropzone with Preview ────────────────────────────────────────────── */

function PhotoDropzone({
  slot,
  onFileChange,
}: {
  slot: FileSlot;
  onFileChange: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleFile = (file: File) => {
    const result = validateImage(file);
    if (!result.valid) {
      setValidationError(result.error ?? 'Invalid file.');
      return;
    }
    setValidationError(null);
    onFileChange(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFile(dropped);
  };

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) handleFile(selected);
  };

  return (
    <div>
      {validationError && (
        <div className="mb-2 text-[10px] font-mono text-red-400 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" />
          {validationError}
        </div>
      )}

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={[
          'border-2 border-dashed p-4 text-center cursor-pointer transition-colors',
          slot.file
            ? 'border-emerald-500/30 bg-emerald-500/5'
            : 'border-white/10 hover:border-white/20 bg-neutral-900',
        ].join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          capture={slot.capture}
          onChange={handleSelect}
          className="hidden"
        />

        {slot.preview ? (
          <div className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={slot.preview}
              alt={slot.label}
              className="w-full max-h-80 mx-auto object-contain rounded"
            />
            <div className="flex items-center justify-center gap-3">
              <span className="text-xs font-mono text-emerald-400 flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5" />
                {slot.file?.name}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setValidationError(null);
                  onFileChange(null);
                }}
                className="text-[10px] font-mono uppercase text-neutral-500 hover:text-red-400 transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="py-4">
            <Camera className="w-6 h-6 text-neutral-500 mx-auto mb-2" />
            <p className="text-[10px] font-mono text-neutral-400">
              Tap to take photo or upload
            </p>
            <p className="text-[9px] font-mono text-neutral-600 mt-1">
              JPG or PNG only
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
