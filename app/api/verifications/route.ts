import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVerificationStatus, submitVerification } from '@/lib/supabase/queries/verifications';

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

    // Extract file extensions
    const extFront = getFileExtension(idFront.name);
    const extBack = getFileExtension(idBack.name);
    const extProof = getFileExtension(proofOfAddress.name);

    // Upload each file to Supabase Storage bucket "verifications"
    const uploads = await Promise.all([
      uploadToStorage(supabase, idFront, `${user.id}/id-front${extFront}`),
      uploadToStorage(supabase, idBack, `${user.id}/id-back${extBack}`),
      uploadToStorage(supabase, proofOfAddress, `${user.id}/proof-of-address${extProof}`),
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

    // Update profile with document paths and set status to pending
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

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot !== -1 ? filename.slice(lastDot) : '';
}

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
      upsert: true, // overwrite if resubmitting
    });

  if (error) {
    return { path: null, error: error.message };
  }

  return { path, error: null };
}
