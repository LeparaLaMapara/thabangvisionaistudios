export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { checkRateLimit } from '@/lib/auth';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import {
  extractPhotoMetadata,
  preferFileMetadata,
  sanitizeClientMetadata,
  type VerificationMetadata,
} from '@/lib/metadata/verification';
import { detectFraudFlags } from '@/lib/metadata/fraud-detection';
import { matchFaces } from '@/lib/agents/tools';
import { STUDIO } from '@/lib/constants';
import { logEvent } from '@/lib/data/events';
import { checkConsents, requiredConsents } from '@/lib/consent';
import { isWriteDenied, writeDeniedEvent } from '@/lib/supabase/write-denied';

// Verification documents live in a private bucket. Since migration 067 they are
// written ONLY by the service role, each to a fresh unique path with no upsert,
// so a document cannot be replaced after it was checked (the storage UPDATE
// policy is gone) and a client cannot plant files the face match never saw.
const BUCKET = 'verifications';

const FILE_NAMES = {
  id_copy: 'id-copy',
  selfie: 'selfie-with-id',
} as const;

const VERIFICATION_COLUMNS = [
  'id', 'display_name', 'avatar_url', 'bio', 'phone', 'location',
  'skills', 'social_links', 'is_verified', 'verification_status',
  'verification_submitted_at', 'verification_reviewed_at',
  'verification_rejected_reason', 'id_front_path', 'id_back_path',
  'selfie_with_id_path', 'verification_metadata', 'verification_ai_check',
  'verification_fraud_flags', 'id_document_hash', 'verification_ip',
  'verification_user_agent', 'verification_attempts', 'created_at',
].join(', ');

// ─── GET — Return current user's verification status ────────────────────────

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: verification, error } = await supabase
    .from('profiles')
    .select(VERIFICATION_COLUMNS)
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.error('[verifications GET]', error.message);
    return NextResponse.json({ error: 'Failed to load verification status.' }, { status: 500 });
  }

  if (!verification) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  return NextResponse.json(verification);
}

// ─── POST — Submit verification documents ───────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await checkRateLimit(`verification:${user.id}`, 3, 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
  }

  try {
    // ── Guard: POPIA consent required before upload ────────────────────
    const { data: consentRow } = await supabase
      .from('profiles')
      .select('popia_consent_at')
      .eq('id', user.id)
      .single();

    if (!consentRow?.popia_consent_at) {
      return NextResponse.json(
        {
          error: 'You must accept the privacy notice before uploading ID documents.',
          code: 'POPIA_CONSENT_REQUIRED',
        },
        { status: 400 },
      );
    }

    // ── Guard: identity-check (biometric) consent, separate from POPIA ──
    // Refuse before anything is uploaded. If the consent store cannot be read
    // we do not proceed: no record, no face comparison.
    const consent = await checkConsents(supabase, user.id, requiredConsents('verification'));
    if (consent.status === 'unavailable') {
      console.error('[verifications] consent store unavailable:', consent.error);
      return NextResponse.json(
        { error: 'Identity checks are temporarily unavailable. Please try again later.', code: 'CONSENT_UNAVAILABLE' },
        { status: 503 },
      );
    }
    if (consent.status !== 'ok') {
      return NextResponse.json(
        { error: 'Please accept the identity check notice first.', code: 'CONSENT_REQUIRED' },
        { status: 400 },
      );
    }

    // ── Guard: check current status and attempt count ──────────────────
    const { data: current } = await supabase
      .from('profiles')
      .select('verification_status, verification_attempts, id_front_path, id_back_path, selfie_with_id_path')
      .eq('id', user.id)
      .single();

    if (current?.verification_status === 'pending') {
      return NextResponse.json(
        { error: 'Your documents are already under review. Please wait for a response.' },
        { status: 409 },
      );
    }

    if (current?.verification_status === 'verified') {
      return NextResponse.json(
        { error: 'Your identity is already verified.' },
        { status: 409 },
      );
    }

    const currentAttempts = current?.verification_attempts ?? 0;
    if (currentAttempts >= 3) {
      return NextResponse.json(
        { error: `Maximum submission attempts reached. Contact support at ${STUDIO.supportEmail}` },
        { status: 429 },
      );
    }

    // ── Parse form data ─────────────────────────────────────────────────
    const formData = await req.formData();

    const idCopy = formData.get('id_copy') as File | null;
    const selfie = formData.get('selfie_with_id') as File | null;
    const confirmed = formData.get('confirmed') === 'true';

    if (!idCopy || !selfie) {
      return NextResponse.json(
        { error: 'Both photos are required: ID copy and selfie with ID.' },
        { status: 400 },
      );
    }

    if (!confirmed) {
      return NextResponse.json(
        { error: 'You must confirm the photos are real.' },
        { status: 400 },
      );
    }

    // ── Validate file types and sizes ─────────────────────────────────
    const maxSize = (STUDIO.verification.maxFileSizeMB ?? 5) * 1024 * 1024;
    const minSize = 50 * 1024; // 50KB minimum
    const imageTypes = [
      'image/jpeg', 'image/png', 'image/webp',
      'image/heic', 'image/heif', 'image/bmp', 'image/tiff',
    ];
    const idAllowedTypes = [...imageTypes, 'application/pdf'];

    if (!idAllowedTypes.includes(idCopy.type)) {
      return NextResponse.json(
        { error: 'ID Copy: Unsupported format. Please use PDF, JPG, PNG, WebP, or HEIC.' },
        { status: 400 },
      );
    }
    if (!imageTypes.includes(selfie.type)) {
      return NextResponse.json(
        { error: 'Selfie: Unsupported image format. Please use JPG, PNG, WebP, or HEIC.' },
        { status: 400 },
      );
    }

    for (const [label, file] of [
      ['ID Copy', idCopy],
      ['Selfie', selfie],
    ] as const) {
      if (file.size < minSize) {
        return NextResponse.json(
          { error: `${label}: File is too small (under 50KB). Please use a higher quality scan or photo.` },
          { status: 400 },
        );
      }
      if (file.size > maxSize) {
        return NextResponse.json(
          { error: `${label}: File is too large. Maximum ${STUDIO.verification.maxFileSizeMB}MB.` },
          { status: 400 },
        );
      }
    }

    // ── Extract EXIF metadata BEFORE uploading ──────────────────────────
    const idCopyBuffer = await idCopy.arrayBuffer();
    const selfieBuffer = await selfie.arrayBuffer();

    // The page shrinks large photos first, which drops their EXIF; it sends
    // what it read beforehand in client_metadata (lib/verification/upload-size.ts).
    let clientMeta: Record<string, unknown> = {};
    try {
      const raw = formData.get('client_metadata');
      if (typeof raw === 'string' && raw.length < 10_000) clientMeta = JSON.parse(raw) ?? {};
    } catch {
      clientMeta = {};
    }
    const idCopyMeta = preferFileMetadata(
      await extractPhotoMetadata(idCopyBuffer),
      sanitizeClientMetadata(clientMeta.id_copy),
    );
    const metadata: VerificationMetadata = {
      id_front: idCopyMeta,
      id_back: idCopyMeta,
      selfie: preferFileMetadata(
        await extractPhotoMetadata(selfieBuffer),
        sanitizeClientMetadata(clientMeta.selfie_with_id),
      ),
      face_match: null,
    };

    // ── Generate document hash for duplicate detection ──────────────────
    const idHash = crypto
      .createHash('sha256')
      .update(Buffer.from(idCopyBuffer))
      .digest('hex');

    // ── Upload files to Supabase Storage (service role, unique paths) ──
    // The user is authenticated above; every path is inside their own folder.
    // A random component means a resubmission never overwrites the previous
    // files, and an old path recorded on the profile keeps resolving until the
    // new submission has been recorded.
    const admin = createAdminClient();
    const storagePaths = {
      id_copy: `${user.id}/${crypto.randomUUID()}-${FILE_NAMES.id_copy}`,
      selfie: `${user.id}/${crypto.randomUUID()}-${FILE_NAMES.selfie}`,
    };

    const uploads = await Promise.all([
      uploadToStorage(admin, Buffer.from(idCopyBuffer), storagePaths.id_copy, idCopy.type),
      uploadToStorage(admin, Buffer.from(selfieBuffer), storagePaths.selfie, selfie.type),
    ]);

    const failedUpload = uploads.find((u) => u.error);
    if (failedUpload) {
      console.error('[verifications] Storage upload error:', failedUpload.error);
      await removeQuietly(admin, uploads.filter((u) => u.path).map((u) => u.path as string));
      return NextResponse.json(
        { error: 'Failed to upload documents. Please try again.' },
        { status: 500 },
      );
    }

    // ── Face match: selfie vs. ID front (via short-lived signed URLs) ──
    try {
      const [selfieUrlRes, idFrontUrlRes] = await Promise.all([
        admin.storage.from(BUCKET).createSignedUrl(storagePaths.selfie, 300),
        admin.storage.from(BUCKET).createSignedUrl(storagePaths.id_copy, 300),
      ]);

      const selfieUrl = selfieUrlRes.data?.signedUrl;
      const idFrontUrl = idFrontUrlRes.data?.signedUrl;

      if (selfieUrl && idFrontUrl) {
        const faceMatch = await matchFaces(selfieUrl, idFrontUrl, user.id);
        metadata.face_match = {
          match: faceMatch.match,
          confidence: faceMatch.confidence,
          reasoning: faceMatch.reasoning,
          checked_at: new Date().toISOString(),
        };
      }
    } catch (faceErr) {
      // Non-fatal: admins can still review manually.
      console.error('[verifications] Face match failed:', faceErr);
    }

    // ── Detect fraud flags from metadata + face match ───────────────────
    const fraudFlags = detectFraudFlags(metadata, metadata.face_match);

    // No certified copy is asked for any more (2026-09-27): the face match
    // above, a person's review and the handover ID check protect the gear;
    // a stamp on a photocopy stopped honest people more than thieves.

    // ── Get request metadata ────────────────────────────────────────────
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    // ── Record the submission ───────────────────────────────────────────
    // submit_verification_for_user (067) is service-role only: the paths,
    // fraud flags and ID hash come from this route, never from the browser.
    // Before 067 is applied that function does not exist yet (PGRST202), so
    // fall back to the original user-session RPC.
    const rpcArgs = {
      p_id_front_path: storagePaths.id_copy,
      p_id_back_path: null,
      p_selfie_with_id_path: storagePaths.selfie,
      p_verification_metadata: metadata,
      p_verification_fraud_flags: fraudFlags,
      p_id_document_hash: idHash,
      p_verification_ip: ip,
      p_verification_user_agent: userAgent,
    };

    let { data: rpcResult, error: rpcError } = await admin.rpc('submit_verification_for_user', {
      p_user_id: user.id,
      ...rpcArgs,
    });

    if (rpcError?.code === 'PGRST202') {
      ({ data: rpcResult, error: rpcError } = await supabase.rpc('submit_verification_request', rpcArgs));
    }

    if (rpcError || !rpcResult?.success) {
      await removeQuietly(admin, [storagePaths.id_copy, storagePaths.selfie]);

      if (rpcError) {
        console.error('[verifications] RPC error:', rpcError.message, rpcError.code);
        if (isWriteDenied(rpcError)) {
          logEvent(writeDeniedEvent({
            userId: user.id,
            route: 'POST /api/verifications',
            table: 'profiles',
            error: rpcError,
          }));
        }
        return NextResponse.json(
          { error: 'Failed to submit verification.' },
          { status: 500 },
        );
      }

      return NextResponse.json(
        { error: rpcResult?.error || 'Failed to submit verification.' },
        { status: 500 },
      );
    }

    // ── The new submission is recorded: remove the previous files ───────
    // (a rejected attempt's documents are no longer needed — POPIA minimality).
    const newPaths = new Set([storagePaths.id_copy, storagePaths.selfie]);
    const oldPaths = [
      current?.id_front_path,
      current?.id_back_path,
      current?.selfie_with_id_path,
    ].filter((p): p is string => Boolean(p) && !newPaths.has(p as string));
    await removeQuietly(admin, oldPaths);

    logEvent({ eventType: 'verification_submitted', eventCategory: 'verification', userId: user.id, metadata: { flags: rpcResult.flags_detected ?? 0 } });

    return NextResponse.json({
      success: true,
      message: `Documents submitted. A person checks them, ${STUDIO.verification.reviewTime}.`,
      flags_detected: rpcResult.flags_detected ?? 0,
    });
  } catch (err) {
    console.error('[verifications] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Failed to process verification request.' },
      { status: 500 },
    );
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function uploadToStorage(
  admin: ReturnType<typeof createAdminClient>,
  buffer: Buffer,
  path: string,
  contentType: string,
): Promise<{ path: string | null; error: string | null }> {
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType,
      upsert: false,
    });

  if (error) {
    return { path: null, error: error.message };
  }

  return { path, error: null };
}

/**
 * Best-effort clean-up. The POPIA retention sweep only deletes paths recorded on
 * a profile, so an unrecorded leftover is logged here rather than retried.
 */
async function removeQuietly(
  admin: ReturnType<typeof createAdminClient>,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await admin.storage.from(BUCKET).remove(paths);
  if (error) {
    console.error('[verifications] Storage clean-up failed:', error.message);
  }
}
