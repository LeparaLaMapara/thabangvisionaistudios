import { createClient } from '@/lib/supabase/server';

// ─── DB row type ─────────────────────────────────────────────────────────────

export type Profile = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  avatar_public_id: string | null;
  skills: string[] | null;
  social_links: Record<string, string> | null;
  location: string | null;
  phone: string | null;
  street_address: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  country: string | null;
  address_lat: number | null;
  address_lng: number | null;
  address_place_id: string | null;
  onboarding_completed_at: string | null;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
};

export type PublicProfile = {
  id: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  skills: string[] | null;
  social_links: Record<string, string> | null;
  location: string | null;
  specializations: string[] | null;
  crew_slug: string | null;
  crew_bio: string | null;
  years_experience: number | null;
  crew_featured: boolean;
  hourly_rate: number | null;
  available_for_hire: boolean;
  portfolio_projects: unknown[] | null;
  is_verified: boolean;
  verification_status: string;
  created_at: string;
};

const PUBLIC_PROFILE_COLUMNS = `
  id, display_name, bio, avatar_url, skills, social_links, location,
  specializations, crew_slug, crew_bio, years_experience, crew_featured,
  hourly_rate, available_for_hire, portfolio_projects, is_verified,
  verification_status, created_at
`;

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
 * Uses public_profiles view — safe for unauthenticated visitors.
 */
export async function getVerifiedProfiles(): Promise<PublicProfile[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('public_profiles')
    .select(PUBLIC_PROFILE_COLUMNS)
    .eq('is_verified', true)
    .order('display_name', { ascending: true, nullsFirst: false });

  if (error) {
    console.error('[getVerifiedProfiles]', error.message);
    return [];
  }

  return (data as PublicProfile[]) ?? [];
}

/**
 * Returns a public profile by id — safe for unauthenticated contexts.
 * Only exposes display-safe columns via the public_profiles view.
 */
export async function getPublicProfileById(id: string): Promise<PublicProfile | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('public_profiles')
    .select(PUBLIC_PROFILE_COLUMNS)
    .eq('id', id)
    .single();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[getPublicProfileById]', error.message);
    }
    return null;
  }

  return data as PublicProfile;
}
