export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendVerificationApproved, sendVerificationRejected } from '@/lib/email';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';

type RouteContext = {
  params: Promise<{ id: string }>;
};

// ─── GET — Return verification details + signed document URLs ───────────────

export async function GET(_req: NextRequest, context: RouteContext) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { id } = await context.params;

  try {
    const supabase = await createClient();
    const { data: profile, error } = await supabase.rpc('admin_get_verification', {
      p_user_id: id,
    });

    if (error || !profile) {
      return NextResponse.json({ error: 'Verification not found.' }, { status: 404 });
    }

    const documents: Record<string, string | null> = {
      idFront: null,
      idBack: null,
      selfieWithId: null,
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

    if (profile.selfie_with_id_path) {
      const { data } = await supabase.storage
        .from('verifications')
        .createSignedUrl(profile.selfie_with_id_path, 3600);
      documents.selfieWithId = data?.signedUrl ?? null;
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
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const limited = rateLimitAdmin(auth.user.id, 'sensitive');
  if (limited) return limited;

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

    const supabase = await createClient();

    if (action === 'approve') {
      const { data: result, error: rpcError } = await supabase.rpc('admin_approve_verification', {
        p_user_id: id,
      });

      if (rpcError) {
        console.error('[admin/verifications] approve RPC error:', rpcError.message);
        return NextResponse.json(
          { error: 'Failed to approve verification.' },
          { status: 500 },
        );
      }

      if (result?.email) {
        await sendVerificationApproved({
          email: result.email,
          displayName: result.display_name || '',
        });
      }
    } else {
      const { data: result, error: rpcError } = await supabase.rpc('admin_reject_verification', {
        p_user_id: id,
        p_reason: reason,
      });

      if (rpcError) {
        console.error('[admin/verifications] reject RPC error:', rpcError.message);
        return NextResponse.json(
          { error: 'Failed to reject verification.' },
          { status: 500 },
        );
      }

      if (result?.email) {
        await sendVerificationRejected({
          email: result.email,
          displayName: result.display_name || '',
          reason,
        });
      }
    }

    const { data: updated } = await supabase.rpc('admin_get_verification', {
      p_user_id: id,
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error('[admin/verifications/[id]] PUT error:', err);
    return NextResponse.json(
      { error: 'Failed to update verification.' },
      { status: 500 },
    );
  }
}
