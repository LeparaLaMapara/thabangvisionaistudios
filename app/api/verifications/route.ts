export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVerificationStatus, submitVerification } from '@/lib/supabase/queries/verifications';
import { STUDIO } from '@/lib/constants';

// Fixed filenames per user — resubmission overwrites automatically via upsert.
// No extension in the path: Supabase stores the file with the content-type header
// so the browser can render it correctly regardless of extension.
const FILE_NAMES = {
  id_front: 'id-front',
  id_back: 'id-back',
  proof_of_address: 'proof-of-address',
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
    // ── Guard: block submission if already pending or verified ───────────
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

    // ── Parse form data ─────────────────────────────────────────────────
    const formData = await req.formData();

    const idFront = formData.get('id_front') as File | null;
    const idBack = formData.get('id_back') as File | null;
    const proofOfAddress = formData.get('proof_of_address') as File | null;

    if (!idFront || !idBack || !proofOfAddress) {
      return NextResponse.json(
        { error: 'All three documents are required: id_front, id_back, proof_of_address.' },
        { status: 400 },
      );
    }

    // ── Validate file types and sizes ───────────────────────────────────
    const maxSize = (STUDIO.verification.maxFileSizeMB ?? 5) * 1024 * 1024;
    const allowedTypes = STUDIO.verification.acceptedTypes;

    for (const [label, file] of [
      ['id_front', idFront],
      ['id_back', idBack],
      ['proof_of_address', proofOfAddress],
    ] as const) {
      if (!allowedTypes.includes(file.type as typeof allowedTypes[number])) {
        return NextResponse.json(
          { error: `${label}: Invalid file type "${file.type}". Allowed: ${allowedTypes.join(', ')}` },
          { status: 400 },
        );
      }
      if (file.size > maxSize) {
        return NextResponse.json(
          { error: `${label}: File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum: ${STUDIO.verification.maxFileSizeMB}MB` },
          { status: 400 },
        );
      }
    }

    // ── If resubmitting (rejected), delete old files first ──────────────
    if (current?.verification_status === 'rejected') {
      const oldPaths = [
        current.id_front_path,
        current.id_back_path,
        current.proof_of_address_path,
      ].filter(Boolean) as string[];

      if (oldPaths.length > 0) {
        await supabase.storage.from('verifications').remove(oldPaths);
      }
    }

    // ── Upload with fixed filenames — upsert overwrites any remnants ────
    const uploads = await Promise.all([
      uploadToStorage(supabase, idFront, `${user.id}/${FILE_NAMES.id_front}`),
      uploadToStorage(supabase, idBack, `${user.id}/${FILE_NAMES.id_back}`),
      uploadToStorage(supabase, proofOfAddress, `${user.id}/${FILE_NAMES.proof_of_address}`),
    ]);

    // Check for upload errors
    const failedUpload = uploads.find((u) => u.error);
    if (failedUpload) {
      console.error('[verifications] Storage upload error:', failedUpload.error);
      return NextResponse.json(
        { error: 'Failed to upload documents. Please try again.' },
        { status: 500 },
      );
    }

    // ── Update profile: new paths, status → pending, timestamp → now ────
    const result = await submitVerification(user.id, {
      idFront: uploads[0].path!,
      idBack: uploads[1].path!,
      proofOfAddress: uploads[2].path!,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to submit verification.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
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
  file: File,
  path: string,
): Promise<{ path: string | null; error: string | null }> {
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error } = await supabase.storage
    .from('verifications')
    .upload(path, buffer, {
      contentType: file.type,
      upsert: true,
    });

  if (error) {
    return { path: null, error: error.message };
  }

  return { path, error: null };
}
