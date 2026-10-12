export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { sendVerificationApproved, sendVerificationRejected } from '@/lib/email';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { logEvent } from '@/lib/data/events';

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

    // The verifications bucket only lets a user read their OWN folder, so an
    // admin's session cannot sign another person's documents. requireAdmin()
    // has passed above; sign with the service role.
    const storage = createAdminClient().storage;

    if (profile.id_front_path) {
      const { data } = await storage
        .from('verifications')
        .createSignedUrl(profile.id_front_path, 3600);
      documents.idFront = data?.signedUrl ?? null;
    }

    if (profile.id_back_path) {
      const { data } = await storage
        .from('verifications')
        .createSignedUrl(profile.id_back_path, 3600);
      documents.idBack = data?.signedUrl ?? null;
    }

    if (profile.selfie_with_id_path) {
      const { data } = await storage
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
  const limited = await rateLimitAdmin(auth.user.id, 'sensitive');
  if (limited) return limited;

  const { id } = await context.params;

  try {
    const { action, reason, notes } = await req.json();
    const adminNotes = typeof notes === 'string' ? notes.trim().slice(0, 2000) : '';

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

    // Only a check that is waiting, with ID photos to look at, can be approved.
    const db = createAdminClient();
    const { data: subject } = await db
      .from('profiles')
      .select('verification_status, id_front_path, selfie_with_id_path')
      .eq('id', id)
      .maybeSingle();
    if (!subject) return NextResponse.json({ error: 'Person not found.' }, { status: 404 });
    if (action === 'approve' && subject.verification_status !== 'pending') {
      return NextResponse.json({ error: `This ID check is ${subject.verification_status ?? 'not started'}, not waiting for a decision.` }, { status: 409 });
    }
    if (action === 'approve' && !subject.id_front_path && !subject.selfie_with_id_path) {
      return NextResponse.json(
        { error: 'They have not sent any ID photos, so there is nothing to approve. Ask them to submit their ID first.', code: 'NO_DOCUMENTS' },
        { status: 409 },
      );
    }

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

    // Who decided, and their notes, kept for the record.
    logEvent({
      eventType: action === 'approve' ? 'verification_approved' : 'verification_rejected',
      eventCategory: 'admin',
      userId: auth.user.id,
      metadata: { subjectId: id, reason: action === 'reject' ? reason : null, notes: adminNotes || null },
    });
    if (action === 'reject') {
      await db.from('moderation_log').insert({
        user_id: id,
        action: 'verification_rejected',
        reason: String(reason).slice(0, 1000),
        admin_id: auth.user.id,
        metadata: adminNotes ? { notes: adminNotes } : {},
      });
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
