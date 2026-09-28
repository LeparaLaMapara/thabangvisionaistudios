export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { sendAccountSuspended } from '@/lib/email';
import { STUDIO } from '@/lib/constants';
import { profileWithEmail } from '@/lib/supabase/profile-email';

// ─── POST — Suspend a user (admin only) ─────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const limited = await rateLimitAdmin(auth.user.id, 'sensitive');
  if (limited) return limited;

  const { id: targetUserId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { reason, expires_at, dispute_id } = body as {
    reason?: string;
    expires_at?: string;
    dispute_id?: string;
  };

  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    return NextResponse.json(
      { error: 'Suspension reason is required.' },
      { status: 400 },
    );
  }

  // Prevent self-suspension
  if (targetUserId === auth.user.id) {
    return NextResponse.json(
      { error: 'You cannot suspend yourself.' },
      { status: 403 },
    );
  }

  // Validate expires_at if provided
  let expiresAt: string | null = null;
  if (expires_at) {
    const parsed = new Date(expires_at);
    if (isNaN(parsed.getTime()) || parsed <= new Date()) {
      return NextResponse.json(
        { error: 'expires_at must be a valid future date.' },
        { status: 400 },
      );
    }
    expiresAt = parsed.toISOString();
  }

  try {
    const supabase = createAdminClient();

    // Verify the target user exists
    const { data: targetProfile, error: profileError } = await supabase
      .from('profiles')
      .select('id, is_suspended')
      .eq('id', targetUserId)
      .single();

    if (profileError || !targetProfile) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    if (targetProfile.is_suspended) {
      return NextResponse.json(
        { error: 'User is already suspended.' },
        { status: 409 },
      );
    }

    // Suspend the user
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        is_suspended: true,
        suspended_at: new Date().toISOString(),
        suspended_by: auth.user.id,
        suspension_reason: reason.trim(),
        suspension_expires_at: expiresAt,
      })
      .eq('id', targetUserId);

    if (updateError) {
      console.error('[admin/users/suspend] Update error:', updateError.message);
      return NextResponse.json({ error: 'Failed to suspend user.' }, { status: 500 });
    }

    // Deactivate user's rental listings
    await supabase
      .from('smart_rentals')
      .update({ is_available: false })
      .eq('owner_id', targetUserId);

    // Insert moderation log entry
    const { error: logError } = await supabase
      .from('moderation_log')
      .insert({
        user_id: targetUserId,
        action: 'suspended',
        reason: reason.trim(),
        admin_id: auth.user.id,
        dispute_id: dispute_id || null,
        metadata: { expires_at: expiresAt },
      });

    if (logError) {
      console.error('[admin/users/suspend] Log error:', logError.message);
      // Don't fail the request — suspension was applied
    }

    // Send suspension email to the user
    try {
      const userProfile = await profileWithEmail(targetUserId);

      if (userProfile?.email) {
        await sendAccountSuspended({
          email: userProfile.email,
          displayName: userProfile.display_name || '',
          reason: reason.trim(),
          expiresAt: expiresAt ?? undefined,
          supportEmail: STUDIO.email,
        });
      }
    } catch {
      // Email failure shouldn't block the response
    }

    return NextResponse.json({ success: true, message: 'User suspended.' });
  } catch (err) {
    console.error('[admin/users/suspend] Error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
