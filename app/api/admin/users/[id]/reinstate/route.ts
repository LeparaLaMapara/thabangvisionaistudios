export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { liftBan } from '@/lib/auth/sessions';
import { sendAccountReinstated } from '@/lib/email';
import { profileWithEmail } from '@/lib/supabase/profile-email';

// ─── POST — Reinstate a suspended user (admin only) ─────────────────────────

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

  const { reason } = body as { reason?: string };

  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    return NextResponse.json(
      { error: 'Reinstatement reason is required.' },
      { status: 400 },
    );
  }

  try {
    const supabase = createAdminClient();

    // Verify the target user exists and is suspended
    const { data: targetProfile, error: profileError } = await supabase
      .from('profiles')
      .select('id, is_suspended')
      .eq('id', targetUserId)
      .single();

    if (profileError || !targetProfile) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    if (!targetProfile.is_suspended) {
      return NextResponse.json(
        { error: 'User is not currently suspended.' },
        { status: 409 },
      );
    }

    // Reinstate the user
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        is_suspended: false,
        suspended_at: null,
        suspended_by: null,
        suspension_reason: null,
        suspension_expires_at: null,
      })
      .eq('id', targetUserId);

    if (updateError) {
      console.error('[admin/users/reinstate] Update error:', updateError.message);
      return NextResponse.json({ error: 'Failed to reinstate user.' }, { status: 500 });
    }

    // Let them sign in again (the suspension's Auth ban, Codex P1).
    const unbanned = await liftBan(targetUserId);

    // Insert moderation log entry
    const { error: logError } = await supabase
      .from('moderation_log')
      .insert({
        user_id: targetUserId,
        action: 'reinstated',
        reason: reason.trim(),
        admin_id: auth.user.id,
        metadata: {},
      });

    if (logError) {
      console.error('[admin/users/reinstate] Log error:', logError.message);
    }

    // Send reinstatement email
    try {
      const userProfile = await profileWithEmail(targetUserId);

      if (userProfile?.email) {
        await sendAccountReinstated({
          email: userProfile.email,
          displayName: userProfile.display_name || '',
        });
      }
    } catch {
      // Email failure shouldn't block the response
    }

    return NextResponse.json({ success: true, message: 'User reinstated.', sign_in_restored: unbanned });
  } catch (err) {
    console.error('[admin/users/reinstate] Error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
