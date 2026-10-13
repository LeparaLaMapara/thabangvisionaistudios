export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { revokeUserSessions } from '@/lib/auth/sessions';
import { logEvent } from '@/lib/data/events';

const VALID_ROLES = ['user', 'admin', 'moderator'] as const;

// ─── PATCH — Change a user's role (admin only) ──────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const limited = await rateLimitAdmin(auth.user.id, 'sensitive');
  if (limited) return limited;

  const { id: targetUserId } = await params;
  const body = await req.json();
  const newRole = body.role as string;

  // Validate role
  if (!VALID_ROLES.includes(newRole as typeof VALID_ROLES[number])) {
    return NextResponse.json(
      { error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` },
      { status: 400 },
    );
  }

  // Prevent self-demotion
  if (targetUserId === auth.user.id && newRole !== 'admin') {
    return NextResponse.json(
      { error: 'You cannot demote yourself. Ask another admin to change your role.' },
      { status: 403 },
    );
  }

  try {
    const supabase = createAdminClient();

    // 1. Set app_metadata.role in auth.users (controls JWT + RLS is_admin())
    const { error: authError } = await supabase.auth.admin.updateUserById(
      targetUserId,
      { app_metadata: { role: newRole } },
    );

    if (authError) {
      console.error('[admin/users/role] Auth metadata update error:', authError.message);
      return NextResponse.json({ error: 'Failed to update auth role.' }, { status: 500 });
    }

    // 2. Sync profiles.role column (secondary check + admin UI display)
    const { data, error } = await supabase
      .from('profiles')
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq('id', targetUserId)
      .select('id, display_name, role')
      .single();

    if (error) {
      console.error('[admin/users/role] Profile update error:', error.message);
      return NextResponse.json({ error: 'Failed to update profile role.' }, { status: 500 });
    }

    // 3. End the user's sessions so the change takes effect now, not when
    //    their current token expires (security AUTH-2: a demoted admin kept
    //    admin over the REST API with the old token). Not for a no-op change
    //    of the caller's own role.
    const sessions = targetUserId === auth.user.id ? { revoked: false, sessions: 0 } : await revokeUserSessions(targetUserId);

    // Who changed whose role, for the record.
    logEvent({ eventType: 'admin_role_changed', eventCategory: 'admin', userId: auth.user.id, metadata: { subjectId: targetUserId, role: newRole } });

    return NextResponse.json({ ...data, sessions_revoked: sessions.revoked });
  } catch (err) {
    console.error('[admin/users/role] Error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
