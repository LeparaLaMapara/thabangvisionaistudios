'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { safeNextPath } from '@/lib/auth/redirect';
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
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { STUDIO } from '@/lib/constants';
import { createClient } from '@/lib/supabase/client';
import { DashboardSubTabs, ACCOUNT_TABS_USER } from '@/components/dashboard/DashboardSubTabs';
import { ConsentStep } from '@/components/verification/ConsentStep';

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
  mode: 'upload' | 'camera';
  file: File | null;
  preview: string | null;
}

const REVIEW_TIME = STUDIO.verification.reviewTime;
const MAX_ATTEMPTS = 3;

const ACCEPTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/bmp',
  'image/tiff',
];

const ACCEPTED_DOC_TYPES = [
  ...ACCEPTED_IMAGE_TYPES,
  'application/pdf',
];

function validateFile(file: File, allowPdf: boolean): { valid: boolean; error?: string } {
  const allowed = allowPdf ? ACCEPTED_DOC_TYPES : ACCEPTED_IMAGE_TYPES;
  if (!allowed.includes(file.type)) {
    return { valid: false, error: allowPdf
      ? 'Unsupported format. Please use JPG, PNG, WebP, HEIC, or PDF.'
      : 'Unsupported image format. Please use JPG, PNG, WebP, or HEIC.'
    };
  }
  if (file.size < 50 * 1024) {
    return { valid: false, error: 'File is too small (under 50KB). Please use a higher quality scan or photo.' };
  }
  const maxSize = (STUDIO.verification.maxFileSizeMB ?? 5) * 1024 * 1024;
  if (file.size > maxSize) {
    return { valid: false, error: `File is too large. Maximum ${STUDIO.verification.maxFileSizeMB}MB.` };
  }
  return { valid: true };
}

function validateImage(file: File): { valid: boolean; error?: string } {
  return validateFile(file, false);
}

export default function VerificationPage() {
  return (
    <Suspense fallback={null}>
      <VerificationPageInner />
    </Suspense>
  );
}

/** "Back to your booking" when they came from a gear page (with its dates). */
function BackToBooking({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-block mt-4 text-xs font-mono text-[#D4A843] underline underline-offset-2 hover:opacity-80"
    >
      Back to your booking
    </Link>
  );
}

function VerificationPageInner() {
  // Where they were booking when they were asked for their ID, if anywhere.
  const back = safeNextPath(useSearchParams().get('redirect'), '');
  const [verification, setVerification] = useState<VerificationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [consented, setConsented] = useState<boolean | null>(null);
  const [files, setFiles] = useState<FileSlot[]>([
    {
      label: 'Photo of your ID',
      description: 'A clear photo of your ID card (front) or the photo page of your ID book. All the text must be readable. No certified copy needed.',
      key: 'id_copy',
      mode: 'upload',
      file: null,
      preview: null,
    },
    {
      label: 'Selfie with your ID',
      description: 'Hold your ID next to your face and take a photo. We need to see both your face and your ID clearly.',
      key: 'selfie_with_id',
      mode: 'camera',
      file: null,
      preview: null,
    },
  ]);

  useEffect(() => {
    fetchVerification();
    fetchConsent();
  }, []);

  async function fetchConsent() {
    try {
      const res = await fetch('/api/popia-consent');
      if (res.ok) {
        const data = await res.json();
        setConsented(!!data.consented);
      } else {
        setConsented(false);
      }
    } catch {
      setConsented(false);
    }
  }

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
      setError('Please upload all required photos.');
      return;
    }

    if (!confirmed) {
      setError('Please confirm that the photos are real.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Your session has expired. Please log in again.');
        setSubmitting(false);
        return;
      }

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
      <DashboardSubTabs tabs={ACCOUNT_TABS_USER} />
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
              A person checks it, {REVIEW_TIME}. We&apos;ll let you know by email.
            </p>
            {back && <BackToBooking href={back} />}
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
          {back && <BackToBooking href={back} />}
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
            A person checks your documents, {REVIEW_TIME}. We&apos;ll let you know by email.
          </p>
          {back && <BackToBooking href={back} />}
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
            consented === false ? (
              <ConsentStep onConsented={() => setConsented(true)} />
            ) : consented === true ? (
              <UploadForm
                files={files}
                confirmed={confirmed}
                onConfirmedChange={setConfirmed}
                onFileChange={handleFileChange}
                onSubmit={handleSubmit}
                submitting={submitting}
              />
            ) : null
          )}
        </div>
      )}

      {/* ── Unverified ──────────────────────────────────────────────── */}
      {status === 'unverified' && (
        consented === false ? (
          <ConsentStep onConsented={() => setConsented(true)} />
        ) : consented === true ? (
          <UploadForm
            files={files}
            confirmed={confirmed}
            onConfirmedChange={setConfirmed}
            onFileChange={handleFileChange}
            onSubmit={handleSubmit}
            submitting={submitting}
          />
        ) : null
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
        A photo of your ID and a selfie holding it. We compare the two faces, then a person checks it.
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
          I confirm this is my real ID and the selfie is of me.
        </span>
      </label>

      <Button onClick={onSubmit} loading={submitting}>
        <Upload className="w-3.5 h-3.5" />
        Submit for Verification
      </Button>
    </Card>
  );
}

/* ── Shared preview & remove strip ──────────────────────────────────────────── */

function PhotoPreview({
  slot,
  onRemove,
}: {
  slot: FileSlot;
  onRemove: () => void;
}) {
  if (!slot.file) return null;
  const isPdf = slot.file.type === 'application/pdf';
  return (
    <div className="space-y-3">
      {isPdf ? (
        <div className="flex flex-col items-center gap-2 py-6">
          <FileText className="w-12 h-12 text-[#D4A843]" />
          <p className="text-xs font-mono text-neutral-400">{slot.file.name}</p>
        </div>
      ) : slot.preview ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={slot.preview}
          alt={slot.label}
          className="w-full max-h-80 mx-auto object-contain rounded"
        />
      ) : null}
      <div className="flex items-center justify-center gap-3">
        <span className="text-xs font-mono text-emerald-400 flex items-center gap-1.5">
          <CheckCircle className="w-3.5 h-3.5" />
          {slot.file.name}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="text-[10px] font-mono uppercase text-neutral-500 hover:text-red-400 transition-colors"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

/* ── Upload dropzone (for ID copy) ─────────────────────────────────────────── */

function UploadDropzone({
  slot,
  onFileChange,
}: {
  slot: FileSlot;
  onFileChange: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleFile = (file: File) => {
    const result = validateFile(file, true);
    if (!result.valid) {
      setValidationError(result.error ?? 'Invalid file.');
      return;
    }
    setValidationError(null);
    onFileChange(file);
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
        onDrop={(e) => {
          e.preventDefault();
          const dropped = e.dataTransfer.files[0];
          if (dropped) handleFile(dropped);
        }}
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
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/bmp,image/tiff,application/pdf"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
          className="hidden"
        />

        {slot.file ? (
          <PhotoPreview slot={slot} onRemove={() => { setValidationError(null); onFileChange(null); }} />
        ) : (
          <div className="py-4">
            <Upload className="w-6 h-6 text-neutral-500 mx-auto mb-2" />
            <p className="text-[10px] font-mono text-neutral-400">
              Click to upload or drag &amp; drop
            </p>
            <p className="text-[9px] font-mono text-neutral-600 mt-1">
              PDF, JPG, PNG, WebP, HEIC accepted
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Camera capture (for selfie — webcam on desktop, native on mobile) ─────── */

function CameraCapture({
  slot,
  onFileChange,
}: {
  slot: FileSlot;
  onFileChange: (file: File | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!cameraOpen || !videoRef.current || !streamRef.current) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    video.play().catch(() => {
      setCameraError('Could not start video. Please try again.');
    });
  }, [cameraOpen]);

  const openCamera = async () => {
    if (isMobile) {
      mobileInputRef.current?.click();
      return;
    }
    setCameraError(null);
    setVideoReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      setCameraOpen(true);
    } catch {
      setCameraError('Could not access camera. Please allow camera permissions and try again.');
    }
  };

  const takePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const w = video.videoWidth || video.clientWidth;
    const h = video.videoHeight || video.clientHeight;
    if (w === 0 || h === 0) {
      setCameraError('Camera not ready yet. Please wait a moment and try again.');
      return;
    }

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraError('Failed to capture photo. Please try again.');
          return;
        }
        const file = new File([blob], 'selfie.jpg', { type: 'image/jpeg' });
        stopCamera();
        onFileChange(file);
      },
      'image/jpeg',
      0.92,
    );
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
    setVideoReady(false);
  };

  const handleMobileCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const result = validateImage(file);
      if (!result.valid) {
        setCameraError(result.error ?? 'Invalid file.');
        return;
      }
      setCameraError(null);
      onFileChange(file);
    }
  };

  return (
    <div>
      {cameraError && (
        <div className="mb-2 text-[10px] font-mono text-red-400 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" />
          {cameraError}
        </div>
      )}

      <input
        ref={mobileInputRef}
        type="file"
        accept="image/*"
        capture="user"
        onChange={handleMobileCapture}
        className="hidden"
      />
      <canvas ref={canvasRef} className="hidden" />

      {slot.preview ? (
        <div className={[
          'border-2 border-dashed p-4 text-center border-emerald-500/30 bg-emerald-500/5',
        ].join(' ')}>
          <PhotoPreview slot={slot} onRemove={() => { setCameraError(null); onFileChange(null); }} />
        </div>
      ) : cameraOpen ? (
        <div className="border-2 border-dashed border-[#D4A843]/40 bg-neutral-900 p-4 space-y-4">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onLoadedMetadata={() => setVideoReady(true)}
            className="w-full max-h-80 mx-auto rounded object-cover"
            style={{ transform: 'scaleX(-1)' }}
          />
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={takePhoto}
              disabled={!videoReady}
              className="w-14 h-14 rounded-full bg-[#D4A843] flex items-center justify-center hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Take photo"
            >
              <Camera className="w-6 h-6 text-black" />
            </button>
            <button
              type="button"
              onClick={stopCamera}
              className="text-[10px] font-mono uppercase text-neutral-500 hover:text-red-400 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div
          onClick={openCamera}
          className="border-2 border-dashed p-4 text-center cursor-pointer transition-colors border-white/10 hover:border-white/20 bg-neutral-900"
        >
          <div className="py-4">
            <Camera className="w-6 h-6 text-neutral-500 mx-auto mb-2" />
            <p className="text-[10px] font-mono text-neutral-400">
              {isMobile ? 'Tap to open camera' : 'Click to open camera'}
            </p>
            <p className="text-[9px] font-mono text-neutral-600 mt-1">
              Take a photo with your {isMobile ? 'phone' : 'webcam'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Route to correct input per slot mode ──────────────────────────────────── */

function PhotoDropzone({
  slot,
  onFileChange,
}: {
  slot: FileSlot;
  onFileChange: (file: File | null) => void;
}) {
  if (slot.mode === 'camera') {
    return <CameraCapture slot={slot} onFileChange={onFileChange} />;
  }
  return <UploadDropzone slot={slot} onFileChange={onFileChange} />;
}
