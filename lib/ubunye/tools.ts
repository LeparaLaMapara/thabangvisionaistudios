import { jsonSchema } from 'ai';
import { STUDIO } from '@/lib/constants';
import { email as emailProvider } from '@/lib/email';
import { escapeIlike } from '@/lib/search/types';
import { getHourlyRate } from '@/lib/supabase/queries/service-bookings';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

// ─── Tool Factory ───────────────────────────────────────────────────────────
// Creates crew tools per-request with a Supabase client closure.
// Uses jsonSchema() for parameter schemas (Zod 4 + AI SDK v6 type inference workaround).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createCrewTools(supabase: SupabaseClient, isAuthenticated = false): Record<string, any> {
  return {
    search_creators: {
      description:
        'Search for verified, available-for-hire creators on the platform. Call this when a client describes what kind of creative professional they need.',
      inputSchema: jsonSchema({
        type: 'object' as const,
        properties: {
          specialization: { type: 'string', description: 'Type of work: photography, cinematography, editing, sound, directing' },
          location: { type: 'string', description: 'City or area, e.g. johannesburg, cape town' },
          budget_max: { type: 'number', description: 'Maximum hourly rate in ZAR' },
        },
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
        if (location) query = query.ilike('location', `%${escapeIlike(location)}%`);
        if (budget_max) query = query.lte('hourly_rate', budget_max);

        const { data, error } = await query;
        if (error) return { error: error.message };
        if (!data || data.length === 0) return { results: [], message: 'No creators found matching your criteria.' };

        // Check which creators have active gigs (busy)
        const creatorIds = data.map((c: { id: string }) => c.id);
        const { data: activeGigs } = await supabase
          .from('crew_requests')
          .select('creator_id')
          .in('creator_id', creatorIds)
          .in('status', ['confirmed', 'paid', 'in_progress']);

        const busyIds = new Set((activeGigs ?? []).map((g: { creator_id: string }) => g.creator_id));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { results: data.map((c: any) => ({
          id: c.id, name: c.display_name, slug: c.crew_slug,
          specializations: c.specializations, hourly_rate: c.hourly_rate,
          location: c.location, years_experience: c.years_experience,
          featured: c.crew_featured, bio: c.crew_bio,
          available: !busyIds.has(c.id),
          profile_url: `/smart-creators/${c.crew_slug}`,
        })) };
      },
    },

    get_creator_detail: {
      description:
        'Get full details about a specific creator including their equipment, recent work, and reviews. Call this when a client asks about a specific creator. Pass either crew_slug or creator_id.',
      inputSchema: jsonSchema({
        type: 'object' as const,
        properties: {
          crew_slug: { type: 'string', description: 'The crew slug from the search results' },
          creator_id: { type: 'string', description: 'The creator UUID (use if slug is not available)' },
        },
      }),
      execute: async ({ crew_slug, creator_id }: { crew_slug?: string; creator_id?: string }) => {
        let creator = null;

        // Try by slug first, then by id
        if (crew_slug) {
          const { data } = await supabase
            .from('profiles').select('*')
            .eq('crew_slug', crew_slug).eq('verification_status', 'verified')
            .eq('available_for_hire', true).single();
          creator = data;
        }

        if (!creator && creator_id) {
          const { data } = await supabase
            .from('profiles').select('*')
            .eq('id', creator_id).eq('verification_status', 'verified')
            .eq('available_for_hire', true).single();
          creator = data;
        }

        // Fallback: search by display_name if slug looks like a name
        if (!creator && crew_slug && crew_slug.includes(' ')) {
          const { data } = await supabase
            .from('profiles').select('*')
            .ilike('display_name', `%${escapeIlike(crew_slug)}%`)
            .eq('verification_status', 'verified')
            .eq('available_for_hire', true)
            .limit(1).single();
          creator = data;
        }

        if (!creator) return { error: 'Creator not found or not available.' };

        // Check if creator has an active gig
        const { data: activeGig } = await supabase
          .from('crew_requests')
          .select('id, status, project_type')
          .eq('creator_id', creator.id)
          .in('status', ['confirmed', 'paid', 'in_progress'])
          .limit(1);

        const isBusy = activeGig && activeGig.length > 0;

        const [gear, productions, reviews] = await Promise.all([
          supabase.from('listings').select('id, title, price, pricing_model, category')
            .eq('user_id', creator.id).eq('is_published', true).is('deleted_at', null).limit(5),
          supabase.from('smart_productions').select('id, title, slug, project_type')
            .contains('crew_ids', [creator.id]).limit(5),
          supabase.from('reviews').select('rating, comment, reviewer_name, created_at')
            .eq('review_type', 'crew').eq('reviewee_id', creator.id).eq('is_published', true)
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
            years_experience: creator.years_experience, profile_url: `/smart-creators/${creator.crew_slug}`,
            avg_rating: avgRating, total_reviews: ratings.length,
            available: !isBusy,
            status: isBusy ? 'Currently busy with an active gig' : 'Available for hire',
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          equipment: gear.data?.map((g: any) => ({ title: g.title, rate: g.price, pricing_model: g.pricing_model, category: g.category })) ?? [],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          recent_work: productions.data?.map((p: any) => ({ title: p.title, type: p.project_type, url: `/smart-production/${p.slug}` })) ?? [],
          reviews: reviews.data ?? [],
        };
      },
    },

    calculate_booking_quote: {
      description:
        'Calculate a booking quote with pricing breakdown. Call this when you have the project category and duration to show the client a quote.',
      inputSchema: jsonSchema({
        type: 'object' as const,
        properties: {
          project_category: { type: 'string', description: 'The project category (e.g. Wedding Photography, Music Video)' },
          duration_hours: { type: 'number', description: 'Number of hours for the booking' },
        },
        required: ['project_category', 'duration_hours'],
      }),
      execute: async ({ project_category, duration_hours }: {
        project_category: string; duration_hours: number;
      }) => {
        if (duration_hours < STUDIO.booking.minBookingHours || duration_hours > STUDIO.booking.maxBookingHours) {
          return { error: `Duration must be between ${STUDIO.booking.minBookingHours} and ${STUDIO.booking.maxBookingHours} hours.` };
        }

        const hourlyRate = getHourlyRate(project_category);
        const subtotal = Math.round(hourlyRate * duration_hours);
        const vat = Math.round(subtotal * (STUDIO.booking.vatRate / 100));
        const total = subtotal + vat;

        return {
          hourly_rate: hourlyRate,
          duration_hours,
          subtotal,
          vat,
          vat_rate: STUDIO.booking.vatRate,
          total,
          currency: 'ZAR',
          platform_commission: `${STUDIO.booking.platformCommission}%`,
          cancellation_policy: STUDIO.booking.cancellationPolicy,
        };
      },
    },

    submit_creator_request: {
      description:
        'Submit a creator booking request. ONLY call this after you have ALL required info AND the client has explicitly confirmed they want to book. Required: creator_id, client_name, client_email, project_type, description (min 20 chars). Ask for missing fields conversationally before calling this tool.',
      inputSchema: jsonSchema({
        type: 'object' as const,
        properties: {
          creator_id: { type: 'string', description: 'The creator UUID from search results' },
          client_name: { type: 'string', description: 'Client full name' },
          client_email: { type: 'string', description: 'Client email address' },
          client_phone: { type: 'string', description: 'Client phone number' },
          project_type: { type: 'string', description: 'photography, cinematography, wedding, corporate, music_video, event, documentary, content_creation, other' },
          preferred_dates: { type: 'string', description: 'When the client needs the work done' },
          location: { type: 'string', description: 'Where the shoot will happen' },
          duration: { type: 'string', description: 'half_day, full_day, multi_day' },
          description: { type: 'string', description: 'What the client needs — min 20 characters' },
          budget_range: { type: 'string', description: 'under_5k, 5k_15k, 15k_50k, 50k_plus, flexible' },
        },
        required: ['creator_id', 'client_name', 'client_email', 'project_type', 'description'],
      }),
      execute: async (params: {
        creator_id: string; client_name: string; client_email: string; client_phone?: string;
        project_type: string; preferred_dates?: string; location?: string; duration?: string;
        description: string; budget_range?: string;
      }) => {
        if (!isAuthenticated) {
          return { error: 'User must be signed in to book a creator. Please ask them to sign in at /login or register at /register first.' };
        }

        // Check for duplicate request (5-minute window)
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data: existing } = await supabase
          .from('crew_requests')
          .select('id')
          .eq('creator_id', params.creator_id)
          .eq('client_email', params.client_email)
          .gte('created_at', fiveMinAgo)
          .limit(1);

        if (existing && existing.length > 0) {
          return {
            error: 'You already submitted a request for this creator. Check your requests at /dashboard/creator-requests',
          };
        }

        // Rate limit: max 5 requests per hour per client
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { data: recentRequests } = await supabase
          .from('crew_requests')
          .select('id')
          .eq('client_email', params.client_email)
          .gte('created_at', oneHourAgo);

        if (recentRequests && recentRequests.length >= 5) {
          return {
            error: 'You have reached the maximum number of booking requests for this hour. Please try again later.',
          };
        }

        // Check if creator has an active gig (Uber-like: one gig at a time)
        const { data: activeGig } = await supabase
          .from('crew_requests')
          .select('id, status')
          .eq('creator_id', params.creator_id)
          .in('status', ['confirmed', 'paid', 'in_progress'])
          .limit(1);

        if (activeGig && activeGig.length > 0) {
          return {
            error: 'This creator is currently busy with an active gig. They will become available once their current project is complete. Try another creator or check back later.',
          };
        }

        // Check if creator has banking details (required for payouts)
        const { data: banking } = await supabase
          .from('banking_details')
          .select('id')
          .eq('user_id', params.creator_id)
          .limit(1);

        if (!banking || banking.length === 0) {
          return {
            error: 'This creator has not set up their banking details yet and cannot accept paid bookings. Please try another creator or check back later.',
          };
        }

        // Lock the rate at time of booking
        const { data: creatorProfile } = await supabase
          .from('profiles')
          .select('hourly_rate')
          .eq('id', params.creator_id)
          .single();

        const hourlyRate = creatorProfile?.hourly_rate ?? 0;
        const hoursMap: Record<string, number> = { half_day: 4, full_day: 8, multi_day: 16 };
        const estimatedHours = hoursMap[params.duration || ''] || 8; // default full day
        const totalAmount = hourlyRate * estimatedHours;
        const depositAmount = totalAmount * 0.20; // 20% deposit

        const { data, error } = await supabase
          .from('crew_requests')
          .insert({
            creator_id: params.creator_id, client_name: params.client_name,
            client_email: params.client_email, client_phone: params.client_phone || null,
            project_type: params.project_type, preferred_dates: params.preferred_dates || null,
            location: params.location || null, duration: params.duration || null,
            description: params.description, budget_range: params.budget_range || null,
            booked_via: 'ubunye',
            quoted_rate: hourlyRate,
            estimated_hours: estimatedHours,
            total_amount: totalAmount,
            deposit_amount: depositAmount,
          })
          .select('id').single();

        if (error) return { error: 'Failed to submit request. Please try again.' };

        // Notify creator of new gig request
        try {
          await supabase.from('notifications').insert({
            user_id: params.creator_id,
            type: 'gig_request',
            title: 'New Gig Request',
            body: `New ${params.project_type} request from ${params.client_name}.`,
            link: '/dashboard/gigs',
          });
        } catch { /* notification failure shouldn't block */ }

        // Send admin notification
        try {
          await emailProvider.sendEmail({
            to: STUDIO.bookingEmail,
            subject: `New creator request: ${params.project_type} — ${params.client_name}`,
            text: `A new creator request was submitted via Ubunye.\n\nClient: ${params.client_name} (${params.client_email})\nProject: ${params.project_type}\nDates: ${params.preferred_dates || 'TBD'}\nLocation: ${params.location || 'TBD'}\nBudget: ${params.budget_range || 'Not specified'}\n\nDescription:\n${params.description}\n\nView in admin: /admin/creator-requests`,
          });
        } catch { /* Email failure shouldn't block */ }

        // Send booking confirmation to the client
        try {
          await emailProvider.sendEmail({
            to: params.client_email,
            subject: `Booking Confirmation — ${STUDIO.name}`,
            text: `Hi ${params.client_name},\n\nYour creator booking request has been submitted successfully!\n\nBooking Reference: ${data.id.slice(0, 8).toUpperCase()}\nProject Type: ${params.project_type}\nPreferred Dates: ${params.preferred_dates || 'To be confirmed'}\nLocation: ${params.location || 'To be confirmed'}\n\nDescription:\n${params.description}\n\nOur team will review your request and reach out within 24 hours to confirm details and next steps.\n\nIf you have any questions, contact us at ${STUDIO.email} or ${STUDIO.phone}.\n\nThank you for choosing ${STUDIO.name}!\n\n—\n${STUDIO.name}\n${STUDIO.meta.url}`,
          });
        } catch { /* Email failure shouldn't block */ }

        return {
          success: true, request_id: data.id,
          message: `Booking submitted! Confirmation sent to ${params.client_email}. Reference: ${data.id.slice(0, 8).toUpperCase()}. ${STUDIO.name} will reach out within 24 hours.`,
        };
      },
    },
  };
}
