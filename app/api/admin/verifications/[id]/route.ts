import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getVerificationStatus,
  approveVerification,
  rejectVerification,
} from '@/lib/supabase/queries/verifications';
import { sendVerificationApproved, sendVerificationRejected } from '@/lib/email';

type RouteContext = {
  params: Promise<{ id: string }>;
};

// ─── GET — Return verification details + signed document URLs ───────────────

export async function GET(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const profile = await getVerificationStatus(id);

    if (!profile) {
      return NextResponse.json({ error: 'Verification not found.' }, { status: 404 });
    }

    // Generate signed URLs for stored documents (1 hour expiry)
    const supabase = await createClient();
    const documents: Record<string, string | null> = {
      idFront: null,
      idBack: null,
      proofOfAddress: null,
    };

    if (profile.id_front_path) {
      const { data } = await supabase.storage
        .from('verifications')
        .createSignedUrl(profile.id_front_path, 3600);
      documents.idFront = data?.signedUrl ?? null;
    }

    if (profile.id_back_path) {
      const { data } = await supabase.storage
        .from('verifications')
        .createSignedUrl(profile.id_back_path, 3600);
      documents.idBack = data?.signedUrl ?? null;
    }

    if (profile.proof_of_address_path) {
      const { data } = await supabase.storage
        .from('verifications')
        .createSignedUrl(profile.proof_of_address_path, 3600);
      documents.proofOfAddress = data?.signedUrl ?? null;
    }

    return NextResponse.json({ profile, documents });
  } catch (err) {
    console.error('[admin/verifications/[id]] GET error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch verification details.' },
      { status: 500 },
    );
  }
}

// ─── PUT — Approve or reject a verification ─────────────────────────────────

export async function PUT(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const { action, reason } = await req.json();

    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json(
        { error: 'Invalid action. Must be "approve" or "reject".' },
        { status: 400 },
      );
    }

    if (action === 'reject' && !reason) {
      return NextResponse.json(
        { error: 'A reason is required when rejecting a verification.' },
        { status: 400 },
      );
    }

    // Fetch the profile to get email and display name for notifications
    const supabase = await createClient();
    const { data: authUser } = await supabase.auth.admin.getUserById(id);
    const userEmail = authUser?.user?.email;

    // Get display name from profile
    const profile = await getVerificationStatus(id);
    const displayName = profile?.display_name || '';

    if (action === 'approve') {
      const result = await approveVerification(id);
      if (!result.success) {
        return NextResponse.json(
          { error: result.error || 'Failed to approve verification.' },
          { status: 500 },
        );
      }

      // Send approval email
      if (userEmail) {
        await sendVerificationApproved({ email: userEmail, displayName });
      }
    } else {
      const result = await rejectVerification(id, reason);
      if (!result.success) {
        return NextResponse.json(
          { error: result.error || 'Failed to reject verification.' },
          { status: 500 },
        );
      }

      // Send rejection email
      if (userEmail) {
        await sendVerificationRejected({ email: userEmail, displayName, reason });
      }
    }

    // Return the updated profile
    const updated = await getVerificationStatus(id);
    return NextResponse.json(updated);
  } catch (err) {
    console.error('[admin/verifications/[id]] PUT error:', err);
    return NextResponse.json(
      { error: 'Failed to update verification.' },
      { status: 500 },
    );
  }
}
