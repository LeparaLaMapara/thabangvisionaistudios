import { createClient, createAdminClient } from '@/lib/supabase/server';
import { STUDIO } from '@/lib/constants';
import { hasCompletePortfolio } from '@/lib/portfolio/validation';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type CrewMember = {
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

export type CrewRequest = {
  id: string;
  creator_id: string;
  client_name: string;
  client_email: string;
  client_phone: string | null;
  project_type: string;
  preferred_dates: string | null;
  description: string;
  budget_range: string | null;
  location: string | null;
  duration: string | null;
  status: string;
  admin_notes: string | null;
  commission_rate: number;
  total_amount: number | null;
  commission_amount: number | null;
  payment_id: string | null;
  booked_via: string;
  created_at: string;
  updated_at: string;
  creator?: CrewMember;
};

export type CrewReview = {
  id: string;
  rating: number;
  comment: string | null;
  reviewer_name: string;
  created_at: string;
};

// ─── Crew Select Columns ────────────────────────────────────────────────────

const CREW_COLUMNS = `
  id, display_name, crew_slug, avatar_url, crew_bio, bio,
  specializations, hourly_rate, location, years_experience,
  crew_featured, skills, social_links, portfolio_projects
`;

// ─── Portfolio Types ─────────────────────────────────────────────────────────

export type CrewPortfolioItem = {
  id: string;
  title: string;
  slug: string;
  project_type: string;
  thumbnail_url: string | null;
  gallery: { url: string; public_id: string }[] | null;
  video_provider: string | null;
  video_url: string | null;
};

// ─── Public Queries ─────────────────────────────────────────────────────────

const PORTFOLIO_COLUMNS = 'id, title, slug, project_type, thumbnail_url, gallery, video_provider, video_url';

/**
 * Returns portfolio productions for a single crew member.
 */
export async function getCrewPortfolio(crewId: string): Promise<CrewPortfolioItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('smart_productions')
    .select(PORTFOLIO_COLUMNS)
    .contains('crew_ids', [crewId])
    .eq('is_published', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getCrewPortfolio]', error.message);
    return [];
  }

  return (data as unknown as CrewPortfolioItem[]) ?? [];
}

export async function getCrewBySlug(slug: string): Promise<CrewMember | null> {
  const supabase = await createClient();

  // Try by crew_slug first
  const { data, error } = await supabase
    .from('profiles')
    .select(CREW_COLUMNS)
    .eq('crew_slug', slug)
    .eq('verification_status', 'verified')
    .eq('available_for_hire', true)
    .single();

  if (data) {
    const member = data as unknown as CrewMember;
    return hasCompletePortfolio(member.portfolio_projects) ? member : null;
  }

  if (error && error.code !== 'PGRST116') {
    console.error('[getCrewBySlug]', error.message);
  }

  // Fallback: try by profile id (for profiles without a crew_slug)
  const { data: byId, error: idErr } = await supabase
    .from('profiles')
    .select(CREW_COLUMNS)
    .eq('id', slug)
    .eq('verification_status', 'verified')
    .eq('available_for_hire', true)
    .single();

  if (idErr && idErr.code !== 'PGRST116') {
    console.error('[getCrewBySlug:id-fallback]', idErr.message);
  }

  if (!byId) return null;
  const fallback = byId as unknown as CrewMember;
  return hasCompletePortfolio(fallback.portfolio_projects) ? fallback : null;
}

/**
 * Returns available creators whose specializations overlap with the given keywords.
 * Used on production category pages to recommend relevant creators.
 * Uses Postgres `&&` (overlap) operator on the specializations array.
 */
export async function getCrewBySpecializations(
  keywords: string[],
  limit = 6,
): Promise<CrewMember[]> {
  if (keywords.length === 0) return [];
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('profiles')
    .select(CREW_COLUMNS)
    .eq('verification_status', 'verified')
    .eq('available_for_hire', true)
    .overlaps('specializations', keywords)
    .order('crew_featured', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[getCrewBySpecializations]', error.message);
    return [];
  }

  return ((data as unknown as CrewMember[]) ?? []).filter((c) =>
    hasCompletePortfolio(c.portfolio_projects),
  );
}

export async function getCrewReviews(creatorId: string): Promise<CrewReview[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('reviews')
    .select('id, rating, comment, reviewer_name, created_at')
    .eq('review_type', 'crew')
    .eq('reviewee_id', creatorId)
    .eq('is_published', true)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('[getCrewReviews]', error.message);
    return [];
  }

  return (data as unknown as CrewReview[]) ?? [];
}

// ─── Creator Dashboard Queries ──────────────────────────────────────────────

export async function getCreatorGigs(creatorId: string): Promise<CrewRequest[]> {
  const supabase = await createClient();

  // Creator sees their own requests WITHOUT client contact info
  const { data, error } = await supabase
    .from('crew_requests')
    .select(
      'id, project_type, preferred_dates, description, budget_range, location, duration, status, booked_via, created_at, updated_at',
    )
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getCreatorGigs]', error.message);
    return [];
  }

  return (data as unknown as CrewRequest[]) ?? [];
}

// ─── Client Queries ─────────────────────────────────────────────────────────

export async function getClientCrewRequests(clientEmail: string): Promise<CrewRequest[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('crew_requests')
    .select(
      `*, creator:profiles!creator_id (
        id, display_name, crew_slug, avatar_url, specializations, hourly_rate
      )`,
    )
    .eq('client_email', clientEmail)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getClientCrewRequests]', error.message);
    return [];
  }

  return (data as unknown as CrewRequest[]) ?? [];
}

// ─── Admin Queries ──────────────────────────────────────────────────────────

export async function getAllCrewRequests(): Promise<CrewRequest[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('crew_requests')
    .select(
      `*, creator:profiles!creator_id (
        id, display_name, phone, avatar_url, specializations, hourly_rate
      )`,
    )
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getAllCrewRequests]', error.message);
    return [];
  }

  return (data as unknown as CrewRequest[]) ?? [];
}

export async function updateCrewRequestStatus(
  requestId: string,
  status: string,
  adminNotes?: string,
  totalAmount?: number,
  commissionAmount?: number,
): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminClient();

  const update: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (adminNotes !== undefined) update.admin_notes = adminNotes;
  if (totalAmount !== undefined) update.total_amount = totalAmount;
  if (commissionAmount !== undefined) update.commission_amount = commissionAmount;

  const { error } = await supabase
    .from('crew_requests')
    .update(update)
    .eq('id', requestId);

  if (error) {
    console.error('[updateCrewRequestStatus]', error.message);
    return { success: false, error: error.message };
  }

  return { success: true };
}

// ─── Lazy Expiry ────────────────────────────────────────────────────────────
// Serverless "lazy expiry" — expire pending crew_requests older than 48 hours.
// Called before returning results on dashboard pages. Idempotent and safe to
// call multiple times.

export async function expireStaleRequests(
  supabase: SupabaseClient,
): Promise<{ id: string; client_email: string; client_name: string; project_type: string; creator_id: string }[]> {
  const cutoff = new Date(
    Date.now() - STUDIO.creators.requestExpiryHours * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from('crew_requests')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .select('id, client_email, client_name, project_type, creator_id');

  if (error) {
    console.error('[expireStaleRequests]', error.message);
    return [];
  }

  const expired = data ?? [];

  // Insert a notification for each creator whose gig expired
  if (expired.length > 0) {
    const notifications = expired.map((r) => ({
      user_id: r.creator_id,
      type: 'gig_expired',
      title: 'Gig request expired',
      body: `A ${r.project_type} request expired after ${STUDIO.creators.requestExpiryHours} hours with no response.`,
      link: '/dashboard/gigs',
      is_read: false,
    }));

    const { error: notifError } = await supabase
      .from('notifications')
      .insert(notifications);

    if (notifError) {
      console.error('[expireStaleRequests:notifications]', notifError.message);
    }

    // Optionally send email to clients — fire-and-forget, non-blocking
    try {
      const { email: emailProvider, isEmailConfigured } = await import('@/lib/email');
      if (isEmailConfigured()) {
        await Promise.allSettled(
          expired.map((r) =>
            emailProvider.sendEmail({
              to: r.client_email,
              subject: `Your ${r.project_type} request has expired — ${STUDIO.shortName}`,
              text: [
                `Hi ${r.client_name},`,
                '',
                `Your ${r.project_type} creator request on ${STUDIO.shortName} expired because the creator did not respond within ${STUDIO.creators.requestExpiryHours} hours.`,
                '',
                'You can submit a new request to another creator at any time.',
                '',
                `— ${STUDIO.shortName}`,
              ].join('\n'),
            }),
          ),
        );
      }
    } catch {
      // Email sending is best-effort; do not block the response
    }
  }

  return expired;
}

// ─── Slug Generation ────────────────────────────────────────────────────────

export function generateCrewSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}
