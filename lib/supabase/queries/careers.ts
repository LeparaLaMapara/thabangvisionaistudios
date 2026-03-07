import { createClient } from '@/lib/supabase/server';

// ─── DB row type ─────────────────────────────────────────────────────────────

export type Career = {
  id: string;
  title: string;
  department: string | null;
  location: string | null;
  description: string | null;
  employment_type: 'full-time' | 'part-time' | 'contract' | 'freelance' | null;
  requirements: string[] | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Returns all published, non-deleted careers ordered by created_at DESC.
 * Safe to call in Server Components — never exposes the service key.
 */
export async function getPublishedCareers(): Promise<Career[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('careers')
    .select('*')
    .eq('is_published', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getPublishedCareers]', error.message);
    return [];
  }

  return (data as Career[]) ?? [];
}

/**
 * Returns a single published career by id, or null if not found.
 * PGRST116 = "no rows" — treated as a normal 404, not an error.
 */
export async function getCareerById(id: string): Promise<Career | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('careers')
    .select('*')
    .eq('id', id)
    .eq('is_published', true)
    .is('deleted_at', null)
    .single();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[getCareerById]', error.message);
    }
    return null;
  }

  return data as Career;
}
