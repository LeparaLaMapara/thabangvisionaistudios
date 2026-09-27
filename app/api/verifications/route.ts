export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { checkRateLimit } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { extractPhotoMetadata, type VerificationMetadata } from '@/lib/metadata/verification';
import { detectFraudFlags } from '@/lib/metadata/fraud-detection';
import { matchFaces } from '@/lib/agents/tools';
import { STUDIO } from '@/lib/constants';

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

    const idCopyMeta = await extractPhotoMetadata(idCopyBuffer);
    const metadata: VerificationMetadata = {
      id_front: idCopyMeta,
      id_back: idCopyMeta,
      selfie: await extractPhotoMetadata(selfieBuffer),
      face_match: null,
    };

    // ── Generate document hash for duplicate detection ──────────────────
    const idHash = crypto
      .createHash('sha256')
      .update(Buffer.from(idCopyBuffer))
      .digest('hex');

    // ── If resubmitting (rejected), delete old files first ──────────────
    if (current?.verification_status === 'rejected') {
      const oldPaths = [
        current.id_front_path,
        current.id_back_path,
        current.selfie_with_id_path,
      ].filter(Boolean) as string[];

      if (oldPaths.length > 0) {
        await supabase.storage.from('verifications').remove(oldPaths);
      }
    }

    // ── Upload files to Supabase Storage ────────────────────────────────
    const storagePaths = {
      id_copy: `${user.id}/${FILE_NAMES.id_copy}`,
      selfie: `${user.id}/${FILE_NAMES.selfie}`,
    };

    const uploads = await Promise.all([
      uploadToStorage(supabase, Buffer.from(idCopyBuffer), storagePaths.id_copy, idCopy.type),
      uploadToStorage(supabase, Buffer.from(selfieBuffer), storagePaths.selfie, selfie.type),
    ]);

    const failedUpload = uploads.find((u) => u.error);
    if (failedUpload) {
      console.error('[verifications] Storage upload error:', failedUpload.error);
      return NextResponse.json(
        { error: 'Failed to upload documents. Please try again.' },
        { status: 500 },
      );
    }

    // ── Face match: selfie vs. ID front (via short-lived signed URLs) ──
    try {
      const [selfieUrlRes, idFrontUrlRes] = await Promise.all([
        supabase.storage.from('verifications').createSignedUrl(storagePaths.selfie, 300),
        supabase.storage.from('verifications').createSignedUrl(storagePaths.id_copy, 300),
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

    // ── Submit via RPC (SECURITY DEFINER — bypasses RLS for status change) ──
    const { data: rpcResult, error: rpcError } = await supabase
      .rpc('submit_verification_request', {
        p_id_front_path: storagePaths.id_copy,
        p_id_back_path: null,
        p_selfie_with_id_path: storagePaths.selfie,
        p_verification_metadata: metadata,
        p_verification_fraud_flags: fraudFlags,
        p_id_document_hash: idHash,
        p_verification_ip: ip,
        p_verification_user_agent: userAgent,
      });

    if (rpcError) {
      console.error('[verifications] RPC error:', rpcError.message, rpcError.code);
      return NextResponse.json(
        { error: 'Failed to submit verification.' },
        { status: 500 },
      );
    }

    if (!rpcResult?.success) {
      return NextResponse.json(
        { error: rpcResult?.error || 'Failed to submit verification.' },
        { status: 500 },
      );
    }

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
  supabase: Awaited<ReturnType<typeof createClient>>,
  buffer: Buffer,
  path: string,
  contentType: string,
): Promise<{ path: string | null; error: string | null }> {
  const { error } = await supabase.storage
    .from('verifications')
    .upload(path, buffer, {
      contentType,
      upsert: true,
    });

  if (error) {
    return { path: null, error: error.message };
  }

  return { path, error: null };
}
