import { createClient } from '@/lib/supabase/server';

// ─── DB row type ─────────────────────────────────────────────────────────────

export type Profile = {
  id: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  avatar_public_id: string | null;
  skills: string[] | null;
  social_links: Record<string, string> | null;
  location: string | null;
  phone: string | null;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
};

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Returns a profile by user id, or null if not found.
 * PGRST116 = "no rows" — treated as a normal 404, not an error.
 */
export async function getProfileById(id: string): Promise<Profile | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[getProfileById]', error.message);
    }
    return null;
  }

  return data as Profile;
}

/**
 * Returns the profile for the currently authenticated user, or null.
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  return getProfileById(user.id);
}

/**
 * Returns all verified profiles ordered by display_name.
 * Used for the public creators directory.
 */
export async function getVerifiedProfiles(): Promise<Profile[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('is_verified', true)
    .order('display_name', { ascending: true, nullsFirst: false });

  if (error) {
    console.error('[getVerifiedProfiles]', error.message);
    return [];
  }

  return (data as Profile[]) ?? [];
}
