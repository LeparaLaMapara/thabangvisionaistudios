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

  // Only creators whose ID check passed: a creator may build a portfolio
  // before verification, and it must not be shown until then.
  let query = supabase
    .from('public_profiles')
    .select('id, display_name, crew_slug, avatar_url, crew_bio, bio, specializations, hourly_rate, location, years_experience, crew_featured, skills, social_links, portfolio_projects')
    .in('id', creatorIds)
    .eq('verification_status', 'verified')
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
 * Creates (or updates) the one smart_productions entry for a creator after
 * onboarding. Idempotent: running it again updates the same row.
 *
 * Written against the schema both databases really have (checked 2026-10-12
 * on dev and prod): smart_productions has no submitted_at column, and there
 * is no unique index on creator_id (only a plain one). Writing submitted_at
 * made every finish fail with "Failed to create production listing."
 * slug IS unique, so an insert that collides with another production's slug
 * retries once with a suffix.
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
  const now = new Date().toISOString();

  // Only columns that exist on both databases (no submitted_at).
  const changes = {
    creator_id: profile.id,
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
    is_featured: profile.crew_featured ?? false,
    year: new Date().getFullYear(),
    crew_ids: [profile.id],
    updated_at: now,
  };

  // One live production per creator. Neither database has a unique index on
  // creator_id, so ON CONFLICT (creator_id) cannot be used: update the live
  // row (the update's returned ids are the lookup), or insert one.
  const updateLive = async (): Promise<{ found: boolean; error: string | null }> => {
    const { data, error } = await supabase
      .from('smart_productions')
      .update(changes)
      .eq('creator_id', profile.id)
      .is('deleted_at', null)
      .select('id');
    if (error) return { found: false, error: error.message };
    return { found: (data ?? []).length > 0, error: null };
  };

  const insertWith = async (rowSlug: string) =>
    supabase.from('smart_productions').insert({
      ...changes,
      slug: rowSlug,
      is_published: false,
      created_at: now,
    });

  let result = await updateLive();
  if (!result.error && !result.found) {
    const { error: insertErr } = await insertWith(slug);
    if (!insertErr) return { success: true };
    if (insertErr.code === '23505') {
      // A parallel request inserted this creator's row first: update it.
      result = await updateLive();
      if (!result.error && !result.found) {
        // Not a race: the slug belongs to another production. Retry once
        // with the creator's id on the end.
        const { error: retryErr } = await insertWith(`${slug}-${profile.id.slice(0, 8)}`);
        if (!retryErr) return { success: true };
        result = { found: false, error: retryErr.message };
      }
    } else {
      result = { found: false, error: insertErr.message };
    }
  }

  if (result.error) {
    console.error('[createCreatorProduction]', result.error);
    return { success: false, error: result.error };
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

  // Only for creators whose ID check passed and who are not suspended:
  // finishing onboarding is not a check, so waiting 7 days must not publish
  // an unverified creator's page.
  const { data: waiting, error: waitingErr } = await supabase
    .from('smart_productions')
    .select('id, creator_id')
    .not('creator_id', 'is', null)
    .eq('is_published', false)
    // created_at, not submitted_at: that column does not exist on either
    // database, so this read failed every day and nothing was published.
    .lt('created_at', cutoff)
    .is('deleted_at', null);
  if (waitingErr) {
    console.error('[autoPublishCreatorProductions]', waitingErr.message);
    return 0;
  }
  const creatorIds = Array.from(new Set((waiting ?? []).map((w: { creator_id: string }) => w.creator_id)));
  if (creatorIds.length === 0) return 0;

  const { data: verified, error: verifiedErr } = await supabase
    .from('profiles')
    .select('id')
    .in('id', creatorIds)
    .eq('verification_status', 'verified')
    .not('is_suspended', 'is', true);
  if (verifiedErr) {
    console.error('[autoPublishCreatorProductions]', verifiedErr.message);
    return 0;
  }
  const allowed = new Set((verified ?? []).map((p: { id: string }) => p.id));
  const ids = (waiting ?? [])
    .filter((w: { id: string; creator_id: string }) => allowed.has(w.creator_id))
    .map((w: { id: string }) => w.id);
  if (ids.length === 0) return 0;

  const { data, error } = await supabase
    .from('smart_productions')
    .update({ is_published: true, updated_at: new Date().toISOString() })
    .in('id', ids)
    .eq('is_published', false)
    .is('deleted_at', null)
    .select('id');

  if (error) {
    console.error('[autoPublishCreatorProductions]', error.message);
    return 0;
  }

  return data?.length ?? 0;
}

/**
 * Published work by one creator.
 *
 * The creator profile page used to render `getPublishedProductions()` sliced to
 * six, with a comment claiming productions had no owner column. They do:
 * `creator_id`, with a foreign key. The effect was that every profile showed the
 * same six projects — other people's work, presented as that person's portfolio.
 *
 * `creator_id` references auth.users(id), and a profile id IS the auth user id,
 * so a profile id is the correct argument here.
 */
export async function getProductionsByCreator(creatorId: string): Promise<SmartProduction[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_productions')
    .select('*')
    .eq('is_published', true)
    .eq('creator_id', creatorId)
    .is('deleted_at', null)
    .order('year', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('[getProductionsByCreator]', error.message);
    return [];
  }

  return (data as SmartProduction[]) ?? [];
}
