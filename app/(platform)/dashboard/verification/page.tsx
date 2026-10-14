'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { safeNextPath } from '@/lib/auth/redirect';
import { verificationNext, type VerificationNext } from '@/lib/verification/return-link';
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
import { createClient } from '@/lib/supabase/client';
import { DashboardSubTabs, ACCOUNT_TABS_USER } from '@/components/dashboard/DashboardSubTabs';
import { ConsentStep } from '@/components/verification/ConsentStep';
import type { PhotoMetadata } from '@/lib/metadata/verification';
import { submitErrorMessage, validateIdPhoto } from '@/lib/verification/photo-format';
import { requestDeviceLocation } from '@/lib/verification/device-location';
import { preparePhoto } from '@/lib/verification/prepare-photo';

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
  /** Which camera takes it: the back camera for the ID, the front one for the selfie. */
  facing: 'environment' | 'user';
  file: File | null;
  preview: string | null;
  /** EXIF read from the original before any conversion (lib/verification/prepare-photo.ts). */
  meta: PhotoMetadata | null;
}

const REVIEW_TIME = STUDIO.verification.reviewTime;
const MAX_ATTEMPTS = 3;

// Photos only, in any format a phone saves (lib/verification/photo-format.ts).
function validateImage(file: File): { valid: boolean; error?: string } {
  return validateIdPhoto(file);
}

export default function VerificationPage() {
  return (
    <Suspense fallback={null}>
      <VerificationPageInner />
    </Suspense>
  );
}

const NEXT_LINK = 'inline-flex items-center min-h-[44px] text-xs font-mono text-[#D4A843] underline underline-offset-2 hover:opacity-80';

/**
 * The next step after the ID check: back to the booking for someone who was
 * renting or booking, the remaining creator steps for someone who came from
 * creator onboarding, or back to the page they were on.
 */
function NextStep({ next, verified = false, linksOnly = false }: { next: VerificationNext; verified?: boolean; linksOnly?: boolean }) {
  if (!next) return null;
  if (next.kind === 'booking') {
    return (
      <Link href={next.href} className={`${NEXT_LINK} mt-2`}>
        Back to your booking
      </Link>
    );
  }
  if (next.kind === 'continue') {
    return (
      <Link href={next.href} className={`${NEXT_LINK} mt-2`}>
        Continue where you were
      </Link>
    );
  }
  // The creator steps are shown once, on the status card, not in the banner too.
  if (linksOnly) return null;
  return (
    <div className="mt-4 text-left">
      <p className="text-xs font-mono text-neutral-300">
        {verified ? 'Next, get ready to be booked:' : 'While we check, get ready to be booked:'}
      </p>
      <ul className="mt-1">
        <li>
          <Link href="/dashboard/portfolio" className={NEXT_LINK}>
            Build your portfolio (one project of 3 photos)
          </Link>
        </li>
        <li>
          <Link href="/dashboard/banking" className={NEXT_LINK}>
            Add the bank account you want to be paid into
          </Link>
        </li>
        {next.draftedGear > 0 && (
          <li>
            <Link href={`/dashboard/listings?drafted=${next.draftedGear}`} className={NEXT_LINK}>
              Finish your {next.draftedGear === 1 ? 'gear draft' : `${next.draftedGear} gear drafts`}
            </Link>
          </li>
        )}
        <li>
          <Link href="/dashboard" className={NEXT_LINK}>
            Go to your dashboard
          </Link>
        </li>
      </ul>
    </div>
  );
}

function VerificationPageInner() {
  // Where they were booking when they were asked for their ID, if anywhere.
  const searchParams = useSearchParams();
  const next = verificationNext({
    redirect: safeNextPath(searchParams.get('redirect'), ''),
    from: searchParams.get('from'),
    drafted: searchParams.get('drafted'),
  });
  const [verification, setVerification] = useState<VerificationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [consented, setConsented] = useState<boolean | null>(null);
  const [files, setFiles] = useState<FileSlot[]>([
    {
      label: 'Photo of your ID',
      description: 'Take a photo of your ID card (front), the photo page of your ID book or your passport. Fill the frame and make sure all the text is sharp.',
      key: 'id_copy',
      facing: 'environment',
      file: null,
      preview: null,
      meta: null,
    },
    {
      label: 'Selfie with your ID',
      description: 'Hold your ID next to your face and take a photo. We need to see both your face and your ID clearly.',
      key: 'selfie_with_id',
      facing: 'user',
      file: null,
      preview: null,
      meta: null,
    },
  ]);

  useEffect(() => {
    fetchVerification();
    fetchConsent();
  }, []);

  async function fetchConsent() {
    try {
      // Both are needed: the POPIA notice (existing) and the separate,
      // versioned identity-check (biometric) consent. If either is missing the
      // notice is shown again; the upload route refuses without both.
      const [popiaRes, consentRes] = await Promise.all([
        fetch('/api/popia-consent'),
        fetch('/api/consent?context=verification'),
      ]);
      if (popiaRes.ok && consentRes.ok) {
        const popia = await popiaRes.json();
        const current = (await consentRes.json()) as { missing?: string[] };
        setConsented(!!popia.consented && (current.missing ?? []).length === 0);
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

  const setSlot = (index: number, file: File | null, meta: PhotoMetadata | null) => {
    setFiles((prev) =>
      prev.map((slot, i) => {
        if (i !== index) return slot;
        // Revoke old preview URL
        if (slot.preview) URL.revokeObjectURL(slot.preview);
        return {
          ...slot,
          file,
          meta,
          preview: file ? URL.createObjectURL(file) : null,
        };
      }),
    );
  };

  // Read the photo's details from the original, and turn an iPhone (HEIC)
  // photo into a JPEG so it can be previewed and checked.
  const handleFileChange = async (index: number, file: File | null) => {
    setError(null);
    if (!file) {
      setSlot(index, null, null);
      return;
    }
    setPreparing(true);
    try {
      const prepared = await preparePhoto(file);
      setSlot(index, prepared.file, prepared.meta);
    } catch {
      setError('We could not open this photo. Please take it again with your phone camera.');
    }
    setPreparing(false);
  };

  const handleSubmit = async () => {
    const allUploaded = files.every((slot) => slot.file !== null);
    if (!allUploaded) {
      setError('Please take both photos.');
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

      // 0. Where they are now (the phone asks "Allow location?"). Optional:
      //    a refusal is recorded and a person looks at it during review.
      const deviceLocation = await requestDeviceLocation();

      // 1. One-time upload links from our server (it picks the paths).
      const linkRes = await fetch('/api/verifications/upload', { method: 'POST' });
      const links = await linkRes.json().catch(() => ({}));
      if (!linkRes.ok) throw new Error(submitErrorMessage(linkRes.status, links.error));

      // 2. The photos go straight to private storage, not through our server,
      //    so their size no longer matters (Vercel caps requests at 4.5 MB).
      const clientMetadata: Record<string, PhotoMetadata> = {};
      const paths: Record<string, string> = {};
      for (const slot of files) {
        const link = links.uploads?.[slot.key] as { path: string; token: string } | undefined;
        if (!link || !slot.file) throw new Error(submitErrorMessage(500, undefined));
        const { error: upErr } = await supabase.storage
          .from(links.bucket)
          .uploadToSignedUrl(link.path, link.token, slot.file, { contentType: slot.file.type || 'image/jpeg' });
        if (upErr) throw new Error('The upload did not finish. Please check your connection and try again.');
        paths[slot.key] = link.path;
        if (slot.meta) clientMetadata[slot.key] = slot.meta;
      }

      // 3. The server reads the originals, keeps small copies and checks them.
      const res = await fetch('/api/verifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_copy_path: paths.id_copy,
          selfie_path: paths.selfie_with_id,
          client_metadata: clientMetadata,
          device_location: deviceLocation,
          confirmed: true,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(submitErrorMessage(res.status, body.error));
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
      <div className="flex items-center justify-center py-20 gap-2 text-neutral-400 font-mono text-sm">
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
      <p className="text-xs font-mono text-neutral-400 mb-8">
        We check your ID once. It lets you rent gear and, if you want to, list your own gear or take bookings.
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
            <NextStep next={next} linksOnly />
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
          <p className="text-xs font-mono text-neutral-400">
            Your identity has been successfully verified. You have full access to platform features.
          </p>
          <NextStep next={next} verified />
          {verification?.verification_reviewed_at && (
            <p className="text-xs font-mono text-neutral-400 mt-4">
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
          <p className="text-xs font-mono text-neutral-400">
            A person checks your documents, {REVIEW_TIME}. We&apos;ll let you know by email.
          </p>
          <NextStep next={next} />
          {verification?.verification_submitted_at && (
            <p className="text-xs font-mono text-neutral-400 mt-4">
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
                  <p className="text-xs font-mono text-neutral-400 mb-2">
                    <span className="text-neutral-400">Reason:</span>{' '}
                    {verification.verification_rejected_reason}
                  </p>
                )}
                {maxReached ? (
                  <p className="text-xs font-mono text-red-400">
                    Maximum attempts reached. Contact support at {STUDIO.supportEmail}
                  </p>
                ) : (
                  <p className="text-xs font-mono text-neutral-400">
                    Please take the photos again below.
                    <span className="text-neutral-400 ml-2">
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
                submitting={submitting || preparing}
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
            submitting={submitting || preparing}
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
      <p className="text-xs font-mono text-neutral-400 mb-8">
        A photo of your ID and a selfie holding it. We compare the two faces, then a person checks it.
      </p>

      <div className="space-y-8 mb-8">
        {files.map((slot, index) => (
          <div key={slot.key}>
            {/* Step indicator */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 bg-white/5 px-2 py-0.5">
                Step {index + 1} of {files.length}
              </span>
              <span className="text-xs font-mono uppercase tracking-widest text-white">
                {slot.label}
              </span>
            </div>

            <p className="text-xs font-mono text-neutral-400 mb-3">
              {slot.description}
            </p>

            {/* Selfie guide */}
            {slot.key === 'selfie_with_id' && (
              <div className="mb-3 p-4 bg-white/[0.02] border border-white/5">
                <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">
                  How to take this photo
                </p>
                <div className="flex items-center gap-4 text-xs font-mono text-neutral-400">
                  <span>Your face</span>
                  <span className="text-neutral-400">+</span>
                  <span>Your ID card visible</span>
                  <span className="text-neutral-400">=</span>
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

      <p className="text-xs font-mono text-neutral-400 mb-4">
        When you submit, your phone asks to share your location. Please allow it: it helps us
        confirm the photos were taken by you, just now.
      </p>

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
  return (
    <div className="space-y-3">
      {slot.preview ? (
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
          className="text-xs font-mono uppercase text-neutral-400 hover:text-red-400 transition-colors"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

/* ── Camera capture (both photos: the phone's camera, or the webcam on a computer) ── */

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
        video: { facingMode: { ideal: slot.facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
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
        const file = new File([blob], `${slot.key}.jpg`, { type: 'image/jpeg' });
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
        <div className="mb-2 text-xs font-mono text-red-400 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" />
          {cameraError}
        </div>
      )}

      <input
        ref={mobileInputRef}
        type="file"
        accept="image/*"
        capture={slot.facing}
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
            style={slot.facing === 'user' ? { transform: 'scaleX(-1)' } : undefined}
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
              className="text-xs font-mono uppercase text-neutral-400 hover:text-red-400 transition-colors"
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
            <Camera className="w-6 h-6 text-neutral-400 mx-auto mb-2" />
            <p className="text-xs font-mono text-neutral-400">
              {isMobile ? 'Tap to open camera' : 'Click to open camera'}
            </p>
            <p className="text-xs font-mono text-neutral-400 mt-1">
              {slot.facing === 'environment'
                ? `Take a photo of your ID with your ${isMobile ? 'phone' : 'webcam'}`
                : `Take a photo with your ${isMobile ? 'phone' : 'webcam'}`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Every photo is taken now, never picked from files ───────────────────── */

function PhotoDropzone({
  slot,
  onFileChange,
}: {
  slot: FileSlot;
  onFileChange: (file: File | null) => void;
}) {
  return <CameraCapture slot={slot} onFileChange={onFileChange} />;
}
