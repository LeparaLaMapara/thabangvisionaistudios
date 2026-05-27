import { createClient, createAdminClient } from '@/lib/supabase/server';
import { PRODUCTION_CATEGORIES } from '@/lib/constants';

// ─── DB row type ─────────────────────────────────────────────────────────────

export type ImageExifMetadata = {
  url: string;
  camera?: string;
  lens?: string;
  focalLength?: number;
  aperture?: number;
  iso?: number;
  shutterSpeed?: string;
  dateTaken?: string;
  software?: string;
};

export type SmartProduction = {
  id: string;
  slug: string;
  title: string;
  client: string | null;
  year: number | null;
  project_type: string;
  sub_category: string | null;
  description: string | null;
  video_provider: string | null;
  video_url: string | null;
  tags: string[] | null;
  thumbnail_url: string | null;
  cover_public_id: string | null;
  gallery: { url: string; public_id: string }[] | null;
  image_metadata: ImageExifMetadata[] | null;
  is_published: boolean;
  is_featured: boolean;
  created_at: string;
  price: number | null;
  currency: string | null;
  price_unit: string;
  creator_id: string | null;
  submitted_at: string | null;
};

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Returns all published productions ordered by year descending.
 * Safe to call in Server Components — never exposes the service key.
 *
 * Note: add .eq('is_archived', false) here once that column exists.
 */
export async function getPublishedProductions(): Promise<SmartProduction[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_productions')
    .select('*')
    .eq('is_published', true)
    .order('year', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('[getPublishedProductions]', error.message);
    return [];
  }

  return (data as SmartProduction[]) ?? [];
}

/**
 * Returns a single published production by slug, or null if not found.
 * PGRST116 = "no rows" — treated as a normal 404, not an error.
 */
/**
 * Returns featured published productions, limited and ordered by created_at DESC.
 * Used on the home page "Latest Work" carousel.
 */
export async function getFeaturedProductions(limit = 6): Promise<SmartProduction[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_productions')
    .select('*')
    .eq('is_published', true)
    .eq('is_featured', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[getFeaturedProductions]', error.message);
    return [];
  }

  return (data as SmartProduction[]) ?? [];
}

/**
 * Returns all archived productions ordered by created_at DESC.
 * If `is_archived` column doesn't exist yet, returns empty array silently.
 */
export async function getArchivedProductions(): Promise<SmartProduction[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_productions')
    .select('*')
    .eq('is_published', true)
    .eq('is_archived', true)
    .order('created_at', { ascending: false });

  if (error) {
    // Column may not exist yet — fail silently
    console.error('[getArchivedProductions]', error.message);
    return [];
  }

  return (data as SmartProduction[]) ?? [];
}

/**
 * Returns published productions filtered by project_type.
 * Used on category detail pages like /studio/category/[slug].
 */
export async function getProductionsByType(projectType: string): Promise<SmartProduction[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_productions')
    .select('*')
    .eq('is_published', true)
    .eq('project_type', projectType)
    .order('year', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('[getProductionsByType]', error.message);
    return [];
  }

  return (data as SmartProduction[]) ?? [];
}

export async function getProductionBySlug(
  slug: string,
): Promise<SmartProduction | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_productions')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .single();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[getProductionBySlug]', error.message);
    }
    return null;
  }

  return data as SmartProduction;
}

/**
 * Returns published studio productions (creator_id IS NULL) for a project type.
 */
export async function getStudioProductionsByType(projectType: string): Promise<SmartProduction[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_productions')
    .select('*')
    .eq('is_published', true)
    .eq('project_type', projectType)
    .is('creator_id', null)
    .order('year', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('[getStudioProductionsByType]', error.message);
    return [];
  }

  return (data as SmartProduction[]) ?? [];
}

/**
 * Returns published creator productions (creator_id IS NOT NULL) for a project type.
 */
export async function getCreatorProductionsByType(projectType: string): Promise<SmartProduction[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_productions')
    .select('*')
    .eq('is_published', true)
    .eq('project_type', projectType)
    .not('creator_id', 'is', null)
    .is('deleted_at', null)
    .order('is_featured', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getCreatorProductionsByType]', error.message);
    return [];
  }

  return (data as SmartProduction[]) ?? [];
}

// ─── Published Creator Profiles ──────────────────────────────────────────────

export type CreatorProfile = {
  id: string;
  display_name: string | null;
  crew_slug: string | null;
  avatar_url: string | null;
  crew_bio: string | null;
  bio: string | null;
  specializations: string[];
  hourly_rate: number | null;
  location: string | null;
  years_experience: number | null;
  crew_featured: boolean;
  skills: string[] | null;
  social_links: Record<string, string> | null;
  portfolio_projects: import('@/types/portfolio').PortfolioProject[] | null;
};

export async function getPublishedCreatorProfiles(limit?: number): Promise<CreatorProfile[]> {
  const supabase = await createClient();

  const { data: prods } = await supabase
    .from('smart_productions')
    .select('creator_id')
    .not('creator_id', 'is', null)
    .eq('is_published', true)
    .is('deleted_at', null);

  if (!prods?.length) return [];

  const creatorIds = [...new Set(prods.map((p: { creator_id: string }) => p.creator_id))];

  let query = supabase
    .from('public_profiles')
    .select('id, display_name, crew_slug, avatar_url, crew_bio, bio, specializations, hourly_rate, location, years_experience, crew_featured, skills, social_links, portfolio_projects')
    .in('id', creatorIds)
    .order('crew_featured', { ascending: false })
    .order('created_at', { ascending: false });

  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  if (error) {
    console.error('[getPublishedCreatorProfiles]', error.message);
    return [];
  }

  return (data as unknown as CreatorProfile[]) ?? [];
}

// ─── Creator Production Queries ──────────────────────────────────────────────

export async function getProductionByCreatorId(
  creatorId: string,
): Promise<SmartProduction | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_productions')
    .select('*')
    .eq('creator_id', creatorId)
    .is('deleted_at', null)
    .single();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[getProductionByCreatorId]', error.message);
    }
    return null;
  }

  return data as SmartProduction;
}

/**
 * Maps a creator's primary specialization to a production_categories project_type
 * using the creatorKeywords array defined in PRODUCTION_CATEGORIES.
 */
function mapSpecializationToProjectType(specializations: string[]): string {
  for (const spec of specializations) {
    const lower = spec.toLowerCase();
    for (const cat of PRODUCTION_CATEGORIES) {
      if (cat.creatorKeywords.some((kw) => kw.toLowerCase() === lower)) {
        return cat.projectType;
      }
    }
  }
  return 'photography';
}

/**
 * Creates (or updates) a smart_productions entry for a creator after onboarding.
 * Uses upsert on creator_id to be idempotent — re-running won't duplicate.
 */
export async function createCreatorProduction(userId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminClient();

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id, display_name, crew_slug, bio, specializations, skills, hourly_rate, portfolio_projects, crew_featured')
    .eq('id', userId)
    .single();

  if (profileErr || !profile) {
    return { success: false, error: profileErr?.message ?? 'Profile not found' };
  }

  const specializations: string[] = profile.specializations ?? [];
  const skills: string[] = profile.skills ?? [];
  const portfolioProjects = (profile.portfolio_projects ?? []) as Array<{
    photos?: Array<{ url: string; public_id: string }>;
    video?: { url: string; public_id: string } | null;
  }>;

  const gallery: { url: string; public_id: string }[] = [];
  let videoUrl: string | null = null;
  let videoProvider: string | null = null;

  for (const project of portfolioProjects) {
    for (const photo of project.photos ?? []) {
      gallery.push({ url: photo.url, public_id: photo.public_id });
    }
    if (!videoUrl && project.video?.url) {
      videoUrl = project.video.url;
      videoProvider = 'cloudinary';
    }
  }

  const slug = profile.crew_slug ?? `creator-${profile.id.slice(0, 8)}`;
  const primarySpec = specializations[0] ?? 'Creative';
  const projectType = mapSpecializationToProjectType(specializations);

  const row = {
    creator_id: profile.id,
    slug,
    title: `${primarySpec} Professional`,
    project_type: projectType,
    description: profile.bio ?? null,
    tags: skills.length > 0 ? skills : specializations,
    gallery: gallery.length > 0 ? gallery : null,
    thumbnail_url: gallery[0]?.url ?? null,
    video_url: videoUrl,
    video_provider: videoProvider,
    price: profile.hourly_rate ?? null,
    price_unit: 'hour',
    currency: 'ZAR',
    is_published: false,
    is_featured: profile.crew_featured ?? false,
    submitted_at: new Date().toISOString(),
    year: new Date().getFullYear(),
    crew_ids: [profile.id],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error: upsertErr } = await supabase
    .from('smart_productions')
    .upsert(row, { onConflict: 'creator_id', ignoreDuplicates: false });

  if (upsertErr) {
    console.error('[createCreatorProduction]', upsertErr.message);
    return { success: false, error: upsertErr.message };
  }

  return { success: true };
}

/**
 * Auto-publishes creator productions that have been pending review for 7+ days.
 * Called by the daily maintenance cron.
 */
export async function autoPublishCreatorProductions(): Promise<number> {
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('smart_productions')
    .update({ is_published: true, updated_at: new Date().toISOString() })
    .not('creator_id', 'is', null)
    .eq('is_published', false)
    .lt('submitted_at', cutoff)
    .is('deleted_at', null)
    .select('id');

  if (error) {
    console.error('[autoPublishCreatorProductions]', error.message);
    return 0;
  }

  return data?.length ?? 0;
}
