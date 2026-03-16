export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';

// ─── GET — List all users with roles (admin only) ───────────────────────────

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    // Use admin client to access all profiles (bypasses RLS)
    const supabase = createAdminClient();

    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, role, is_verified, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[admin/users] Profiles fetch error:', error.message);
      return NextResponse.json({ error: 'Failed to fetch users.' }, { status: 500 });
    }

    // Fetch emails from auth.users via admin API
    const usersWithEmails = await Promise.all(
      (profiles ?? []).map(async (profile) => {
        try {
          const { data } = await supabase.auth.admin.getUserById(profile.id);
          return {
            ...profile,
            email: data?.user?.email ?? null,
          };
        } catch {
          return { ...profile, email: null };
        }
      }),
    );

    return NextResponse.json(usersWithEmails);
  } catch (err) {
    console.error('[admin/users] Error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
