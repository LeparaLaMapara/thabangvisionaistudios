export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { getVerificationStatus, submitVerification } from '@/lib/supabase/queries/verifications';
import { extractPhotoMetadata } from '@/lib/metadata/verification';
import { detectFraudFlags } from '@/lib/metadata/fraud-detection';
import { STUDIO } from '@/lib/constants';

// Fixed filenames per user — resubmission overwrites automatically via upsert.
const FILE_NAMES = {
  id_front: 'id-front',
  id_back: 'id-back',
  selfie: 'selfie-with-id',
} as const;

// ─── GET — Return current user's verification status ────────────────────────

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const verification = await getVerificationStatus(user.id);

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

  try {
    // ── Guard: check current status and attempt count ──────────────────
    const current = await getVerificationStatus(user.id);

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

    const idFront = formData.get('id_front') as File | null;
    const idBack = formData.get('id_back') as File | null;
    const selfie = formData.get('selfie_with_id') as File | null;
    const confirmed = formData.get('confirmed') === 'true';

    if (!idFront || !idBack || !selfie) {
      return NextResponse.json(
        { error: 'All three photos are required: ID front, ID back, and selfie with ID.' },
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
    const minSize = 200 * 1024; // 200KB minimum
    const allowedTypes = ['image/jpeg', 'image/png'];

    for (const [label, file] of [
      ['ID Front', idFront],
      ['ID Back', idBack],
      ['Selfie', selfie],
    ] as const) {
      if (!allowedTypes.includes(file.type)) {
        return NextResponse.json(
          { error: `${label}: Only JPG and PNG files allowed.` },
          { status: 400 },
        );
      }
      if (file.size < minSize) {
        return NextResponse.json(
          { error: `${label}: Photo is too small. Please take a clearer photo.` },
          { status: 400 },
        );
      }
      if (file.size > maxSize) {
        return NextResponse.json(
          { error: `${label}: Photo is too large. Maximum ${STUDIO.verification.maxFileSizeMB}MB.` },
          { status: 400 },
        );
      }
    }

    // ── Extract EXIF metadata BEFORE uploading ──────────────────────────
    const idFrontBuffer = await idFront.arrayBuffer();
    const idBackBuffer = await idBack.arrayBuffer();
    const selfieBuffer = await selfie.arrayBuffer();

    const metadata = {
      id_front: await extractPhotoMetadata(idFrontBuffer),
      id_back: await extractPhotoMetadata(idBackBuffer),
      selfie: await extractPhotoMetadata(selfieBuffer),
    };

    // ── Generate document hash for duplicate detection ──────────────────
    const idHash = crypto
      .createHash('sha256')
      .update(Buffer.from(idFrontBuffer))
      .digest('hex');

    // Check for duplicate across other users
    const { data: duplicate } = await supabase
      .from('profiles')
      .select('id, display_name')
      .eq('id_document_hash', idHash)
      .neq('id', user.id)
      .single();

    // ── Detect fraud flags from metadata ────────────────────────────────
    const fraudFlags = detectFraudFlags(metadata);

    if (duplicate) {
      fraudFlags.push({
        severity: 'high',
        code: 'DUPLICATE_ID',
        message: 'Same ID document submitted by another account',
      });
    }

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
      id_front: `${user.id}/${FILE_NAMES.id_front}`,
      id_back: `${user.id}/${FILE_NAMES.id_back}`,
      selfie: `${user.id}/${FILE_NAMES.selfie}`,
    };

    const uploads = await Promise.all([
      uploadToStorage(supabase, Buffer.from(idFrontBuffer), storagePaths.id_front, idFront.type),
      uploadToStorage(supabase, Buffer.from(idBackBuffer), storagePaths.id_back, idBack.type),
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

    // ── Get request metadata ────────────────────────────────────────────
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    // ── Update profile via query helper ─────────────────────────────────
    const result = await submitVerification(user.id, {
      idFrontPath: storagePaths.id_front,
      idBackPath: storagePaths.id_back,
      selfiePath: storagePaths.selfie,
      metadata,
      fraudFlags,
      idDocumentHash: idHash,
      ip,
      userAgent,
      currentAttempts,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to submit verification.' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: `Documents submitted successfully. We'll review your verification within ${STUDIO.verification.reviewDays}.`,
      flags_detected: fraudFlags.length,
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
