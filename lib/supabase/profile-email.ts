import { createAdminClient } from '@/lib/supabase/server';

/**
 * A person's display name and email. Emails live in auth.users, not in
 * profiles; several routes asked profiles for an email column that does not
 * exist, so their queries failed and their emails were never sent.
 */
export async function profileWithEmail(
  userId: string | null | undefined,
): Promise<{ id: string; display_name: string | null; email: string | null } | null> {
  if (!userId) return null;
  const admin = createAdminClient();
  const [{ data: profile }, { data: auth }] = await Promise.all([
    admin.from('profiles').select('id, display_name').eq('id', userId).maybeSingle(),
    admin.auth.admin.getUserById(userId),
  ]);
  if (!profile && !auth?.user) return null;
  return { id: userId, display_name: profile?.display_name ?? null, email: auth?.user?.email ?? null };
}
