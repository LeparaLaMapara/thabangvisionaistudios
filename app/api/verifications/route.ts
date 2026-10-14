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
import { matchFacesFromData, readIdDocument } from '@/lib/agents/tools/vision';
import { STUDIO } from '@/lib/constants';
import { logEvent } from '@/lib/data/events';
import { isWriteDenied, writeDeniedEvent } from '@/lib/supabase/write-denied';
import { checkCanSubmit, isOwnStagingPath } from '@/lib/verification/submit-guards';
import { MAX_ID_PHOTO_BYTES, MIN_ID_PHOTO_BYTES, MIN_ID_PHOTO_EDGE, sniffPhotoType } from '@/lib/verification/photo-format';
import { makeReviewCopy, photoSize } from '@/lib/verification/review-copy';
import { parseIdReading, summariseIdReading, validSaIdNumber } from '@/lib/verification/id-reading';

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
//
// The browser first uploads both original photos to its own staging folder
// with links from POST /api/verifications/upload (straight to storage: Vercel
// refuses request bodies over 4.5 MB). This route then, in order:
//   1. reads each original: real format from its bytes (photos only, no PDF),
//      EXIF, and the ID photo's fingerprint;
//   2. makes the review copies (upright, 2400 px, JPEG, no EXIF/GPS);
//   3. has the vision model read the ID document and compare the faces;
//   4. stores the review copies, records the submission, deletes the originals.

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(req.headers.get('content-type') ?? '').includes('application/json')) {
    // A page loaded before this change still sends the files themselves.
    return NextResponse.json({ error: 'Please refresh this page and try again.' }, { status: 400 });
  }

  if (!(await checkRateLimit(`verification:${user.id}`, 3, 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
  }

  const admin = createAdminClient();
  const staged: string[] = [];

  try {
    const guard = await checkCanSubmit(supabase, user.id);
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
    const current = guard.current;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const idPath = body?.id_copy_path;
    const selfiePath = body?.selfie_path;
    if (!isOwnStagingPath(idPath, user.id, 'id_copy') || !isOwnStagingPath(selfiePath, user.id, 'selfie_with_id')) {
      return NextResponse.json({ error: 'Both photos are required: ID photo and selfie with ID.' }, { status: 400 });
    }
    staged.push(idPath, selfiePath);

    if (body?.confirmed !== true) {
      return NextResponse.json({ error: 'You must confirm the photos are real.' }, { status: 400 });
    }

    // ── 1. Read the originals ───────────────────────────────────────────
    const [idOriginal, selfieOriginal] = await Promise.all([
      downloadOriginal(admin, idPath),
      downloadOriginal(admin, selfiePath),
    ]);
    for (const [label, file] of [['ID photo', idOriginal], ['Selfie', selfieOriginal]] as const) {
      if (!file) {
        return NextResponse.json({ error: `${label}: the upload did not arrive. Please try again.` }, { status: 400 });
      }
      if (file.length > MAX_ID_PHOTO_BYTES || file.length < MIN_ID_PHOTO_BYTES) {
        return NextResponse.json({ error: `${label}: please take a clearer photo with your phone camera.` }, { status: 400 });
      }
      const type = sniffPhotoType(file);
      if (!type) {
        return NextResponse.json(
          { error: `${label}: please use a photo (JPG, PNG, WebP or HEIC). PDFs are not accepted.` },
          { status: 400 },
        );
      }
      if (type === 'image/heic') {
        // The page converts HEIC to JPEG before upload; an older page did not.
        return NextResponse.json({ error: 'Please refresh this page and try again.' }, { status: 400 });
      }
    }
    const idBytes = idOriginal as Buffer;
    const selfieBytes = selfieOriginal as Buffer;
    for (const [label, file] of [['ID photo', idBytes], ['Selfie', selfieBytes]] as const) {
      const size = await photoSize(file);
      if (!size) {
        return NextResponse.json({ error: `${label}: we could not open this photo. Please take it again.` }, { status: 400 });
      }
      if (Math.min(size.width, size.height) < MIN_ID_PHOTO_EDGE) {
        return NextResponse.json({ error: `${label}: the photo is too small to read. Please take it again with your phone camera.` }, { status: 400 });
      }
    }

    // The page reads EXIF before converting a HEIC photo (the JPEG has none)
    // and sends it as client_metadata; the file's own EXIF wins when present.
    const clientMeta =
      body?.client_metadata && typeof body.client_metadata === 'object'
        ? (body.client_metadata as Record<string, unknown>)
        : {};
    const idCopyMeta = preferFileMetadata(
      await extractPhotoMetadata(toArrayBuffer(idBytes)),
      sanitizeClientMetadata(clientMeta.id_copy),
    );
    const metadata: VerificationMetadata = {
      id_front: idCopyMeta,
      id_back: idCopyMeta,
      selfie: preferFileMetadata(
        await extractPhotoMetadata(toArrayBuffer(selfieBytes)),
        sanitizeClientMetadata(clientMeta.selfie_with_id),
      ),
      face_match: null,
      id_document: null,
    };

    // ── 2. Review copies ────────────────────────────────────────────────
    let idCopy: Buffer;
    let selfieCopy: Buffer;
    try {
      [idCopy, selfieCopy] = await Promise.all([makeReviewCopy(idBytes), makeReviewCopy(selfieBytes)]);
    } catch (imgErr) {
      console.error('[verifications] could not read a photo:', imgErr);
      return NextResponse.json({ error: 'We could not open one of the photos. Please take it again.' }, { status: 400 });
    }

    // ── 3. Read the ID and compare the faces (non-fatal: a person reviews) ──
    const idB64 = idCopy.toString('base64');
    const [reading, faceMatch] = await Promise.all([
      readIdDocument(idB64, user.id)
        .then(parseIdReading)
        .catch((e) => {
          console.error('[verifications] ID reading failed:', e);
          return null;
        }),
      matchFacesFromData(selfieCopy.toString('base64'), idB64, user.id).catch((e) => {
        console.error('[verifications] Face match failed:', e);
        return null;
      }),
    ]);
    const now = new Date();
    if (reading) {
      try {
        metadata.id_document = summariseIdReading(reading, now);
      } catch (e) {
        console.error('[verifications] ID summary failed:', e);
      }
    }
    if (faceMatch) {
      metadata.face_match = {
        match: faceMatch.match,
        confidence: faceMatch.confidence,
        reasoning: faceMatch.reasoning,
        checked_at: now.toISOString(),
      };
    }
    // The automatic checks only help the reviewer: if one breaks, the
    // submission still goes to a person, with a note saying so.
    let fraudFlags: ReturnType<typeof detectFraudFlags>;
    try {
      fraudFlags = detectFraudFlags(metadata, metadata.face_match);
    } catch (e) {
      console.error('[verifications] Fraud checks failed:', e);
      fraudFlags = [{ severity: 'medium', code: 'CHECKS_FAILED', message: 'Automatic checks could not run; review by eye' }];
    }

    // Duplicate check: the database flags DUPLICATE_ID when another account
    // has the same hash. A valid ID number identifies the document (two photos
    // of it never share an image hash). Keyed, so it cannot be reversed.
    const idNumber = reading ? validSaIdNumber(reading) : null;
    const pepper = process.env.ID_HASH_PEPPER;
    const idHash =
      idNumber && pepper
        ? crypto.createHmac('sha256', pepper).update(`sa-id:${idNumber}`).digest('hex')
        : crypto.createHash('sha256').update(idBytes).digest('hex');

    // ── 4. Store the review copies and record the submission ────────────
    // Fresh unique paths, service role, no upsert (067): a document cannot be
    // replaced after it was checked.
    const storagePaths = {
      id_copy: `${user.id}/${crypto.randomUUID()}-${FILE_NAMES.id_copy}`,
      selfie: `${user.id}/${crypto.randomUUID()}-${FILE_NAMES.selfie}`,
    };
    const uploads = await Promise.all([
      uploadToStorage(admin, idCopy, storagePaths.id_copy, 'image/jpeg'),
      uploadToStorage(admin, selfieCopy, storagePaths.selfie, 'image/jpeg'),
    ]);
    const failedUpload = uploads.find((u) => u.error);
    if (failedUpload) {
      console.error('[verifications] Storage upload error:', failedUpload.error);
      await removeQuietly(admin, uploads.filter((u) => u.path).map((u) => u.path as string));
      return NextResponse.json({ error: 'Failed to upload documents. Please try again.' }, { status: 500 });
    }

    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    // submit_verification_for_user (067) is service-role only: the paths,
    // fraud flags and ID hash come from this route, never from the browser.
    const { data: rpcResult, error: rpcError } = await admin.rpc('submit_verification_for_user', {
      p_user_id: user.id,
      p_id_front_path: storagePaths.id_copy,
      p_id_back_path: null,
      p_selfie_with_id_path: storagePaths.selfie,
      p_verification_metadata: metadata,
      p_verification_fraud_flags: fraudFlags,
      p_id_document_hash: idHash,
      p_verification_ip: ip,
      p_verification_user_agent: userAgent,
    });

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
        return NextResponse.json({ error: 'Failed to submit verification.' }, { status: 500 });
      }
      return NextResponse.json({ error: rpcResult?.error || 'Failed to submit verification.' }, { status: 500 });
    }

    // The new submission is recorded: remove the previous files
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
    return NextResponse.json({ error: 'Failed to process verification request.' }, { status: 500 });
  } finally {
    // The originals (full size, with EXIF and GPS) are never kept.
    await removeQuietly(admin, staged);
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

/** An original from the staging folder, or null when it is not there. */
async function downloadOriginal(
  admin: ReturnType<typeof createAdminClient>,
  path: string,
): Promise<Buffer | null> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
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
