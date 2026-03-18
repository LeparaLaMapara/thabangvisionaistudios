import { z } from 'zod';
import { STUDIO } from '@/lib/constants';
import { email as emailProvider } from '@/lib/email';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

// ─── Tool Factory ───────────────────────────────────────────────────────────
// Creates crew tools per-request with a Supabase client closure.
// Note: Zod 4 + AI SDK v6 has a type inference mismatch on tool(),
// so we cast the return. Runtime behavior is correct.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createCrewTools(supabase: SupabaseClient): Record<string, any> {
  return {
    search_crew: {
      description:
        'Search for verified, available-for-hire crew members on the platform. Call this when a client describes what kind of creative professional they need.',
      parameters: z.object({
        specialization: z.string().optional().describe('Type of work: photography, cinematography, editing, sound, directing'),
        location: z.string().optional().describe('City or area, e.g. johannesburg, cape town'),
        budget_max: z.number().optional().describe('Maximum hourly rate in ZAR'),
      }),
      execute: async ({ specialization, location, budget_max }: {
        specialization?: string; location?: string; budget_max?: number;
      }) => {
        let query = supabase
          .from('profiles')
          .select('id, display_name, crew_slug, avatar_url, crew_bio, specializations, hourly_rate, location, years_experience, crew_featured')
          .eq('verification_status', 'verified')
          .eq('available_for_hire', true)
          .order('crew_featured', { ascending: false })
          .limit(5);

        if (specialization) query = query.contains('specializations', [specialization.toLowerCase()]);
        if (location) query = query.ilike('location', `%${location}%`);
        if (budget_max) query = query.lte('hourly_rate', budget_max);

        const { data, error } = await query;
        if (error) return { error: error.message };
        if (!data || data.length === 0) return { results: [], message: 'No crew found matching your criteria.' };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { results: data.map((c: any) => ({
          id: c.id, name: c.display_name, slug: c.crew_slug,
          specializations: c.specializations, hourly_rate: c.hourly_rate,
          location: c.location, years_experience: c.years_experience,
          featured: c.crew_featured, bio: c.crew_bio,
          profile_url: `/crew/${c.crew_slug}`,
        })) };
      },
    },

    get_crew_detail: {
      description:
        'Get full details about a specific crew member including their equipment, recent work, and reviews. Call this when a client asks about a specific creator.',
      parameters: z.object({
        crew_slug: z.string().describe('The crew slug from the search results'),
      }),
      execute: async ({ crew_slug }: { crew_slug: string }) => {
        const { data: creator } = await supabase
          .from('profiles').select('*')
          .eq('crew_slug', crew_slug).eq('verification_status', 'verified')
          .eq('available_for_hire', true).single();

        if (!creator) return { error: 'Creator not found or not available.' };

        const [gear, productions, reviews] = await Promise.all([
          supabase.from('listings').select('id, title, price, pricing_model, category')
            .eq('user_id', creator.id).eq('is_published', true).is('deleted_at', null).limit(5),
          supabase.from('smart_productions').select('id, title, slug, project_type')
            .contains('crew_ids', [creator.id]).limit(5),
          supabase.from('crew_reviews').select('rating, review_text, reviewer_name, created_at')
            .eq('creator_id', creator.id).eq('is_published', true)
            .order('created_at', { ascending: false }).limit(5),
        ]);

        const ratings = reviews.data?.map((r: { rating: number }) => r.rating) ?? [];
        const avgRating = ratings.length > 0
          ? (ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length).toFixed(1)
          : null;

        return {
          creator: {
            id: creator.id, name: creator.display_name, slug: creator.crew_slug,
            bio: creator.crew_bio || creator.bio, specializations: creator.specializations,
            hourly_rate: creator.hourly_rate, location: creator.location,
            years_experience: creator.years_experience, profile_url: `/crew/${creator.crew_slug}`,
            avg_rating: avgRating, total_reviews: ratings.length,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          equipment: gear.data?.map((g: any) => ({ title: g.title, rate: g.price, pricing_model: g.pricing_model, category: g.category })) ?? [],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          recent_work: productions.data?.map((p: any) => ({ title: p.title, type: p.project_type, url: `/smart-production/${p.slug}` })) ?? [],
          reviews: reviews.data ?? [],
        };
      },
    },

    submit_crew_request: {
      description:
        'Submit a crew booking request. ONLY call this after you have ALL required info AND the client has explicitly confirmed they want to book. Required: creator_id, client_name, client_email, project_type, description (min 20 chars). Ask for missing fields conversationally before calling this tool.',
      parameters: z.object({
        creator_id: z.string().describe('The creator UUID from search results'),
        client_name: z.string().min(1).describe('Client full name'),
        client_email: z.string().email().describe('Client email address'),
        client_phone: z.string().optional().describe('Client phone number'),
        project_type: z.string().describe('photography, cinematography, wedding, corporate, music_video, event, documentary, content_creation, other'),
        preferred_dates: z.string().optional().describe('When the client needs the work done'),
        location: z.string().optional().describe('Where the shoot will happen'),
        duration: z.string().optional().describe('half_day, full_day, multi_day'),
        description: z.string().min(20).describe('What the client needs — min 20 characters'),
        budget_range: z.string().optional().describe('under_5k, 5k_15k, 15k_50k, 50k_plus, flexible'),
      }),
      execute: async (params: {
        creator_id: string; client_name: string; client_email: string; client_phone?: string;
        project_type: string; preferred_dates?: string; location?: string; duration?: string;
        description: string; budget_range?: string;
      }) => {
        const { data, error } = await supabase
          .from('crew_requests')
          .insert({
            creator_id: params.creator_id, client_name: params.client_name,
            client_email: params.client_email, client_phone: params.client_phone || null,
            project_type: params.project_type, preferred_dates: params.preferred_dates || null,
            location: params.location || null, duration: params.duration || null,
            description: params.description, budget_range: params.budget_range || null,
            booked_via: 'ubunye',
          })
          .select('id').single();

        if (error) return { error: 'Failed to submit request. Please try again.' };

        try {
          await emailProvider.sendEmail({
            to: STUDIO.bookingEmail,
            subject: `New crew request: ${params.project_type} — ${params.client_name}`,
            text: `A new crew request was submitted via Ubunye.\n\nClient: ${params.client_name} (${params.client_email})\nProject: ${params.project_type}\nDates: ${params.preferred_dates || 'TBD'}\nLocation: ${params.location || 'TBD'}\nBudget: ${params.budget_range || 'Not specified'}\n\nDescription:\n${params.description}\n\nView in admin: /admin/crew-requests`,
          });
        } catch { /* Email failure shouldn't block */ }

        return {
          success: true, request_id: data.id,
          message: `Request submitted successfully. ${STUDIO.name} will review and reach out to ${params.client_name} within 24 hours.`,
        };
      },
    },
  };
}
