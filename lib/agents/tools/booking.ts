import { jsonSchema } from 'ai';
import { nanoid } from 'nanoid';
import { STUDIO } from '@/lib/constants';
import { payments } from '@/lib/payments';
import { email as emailProvider } from '@/lib/email';
import { escapeIlike } from '@/lib/search/types';
import { getHourlyRate } from '@/lib/supabase/queries/service-bookings';
import { logEvent } from '@/lib/data/events';
import { markConversion } from '@/lib/data/chat-history';
import { createAdminClient } from '@/lib/supabase/server';

// Writes that touch money or status go through the service role, after the
// route has checked who the user is and that the record is theirs. The users'
// own sessions may only read these tables (see the RLS migration of 2026-09-27).
const admin = () => createAdminClient();

// ─── Booking Tools for Booking Agent ──────────────────────────────────────────
// Tools focused on booking flows, quotes, and request submission.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

const BRIEF_REQUIRED_FIELDS = [
  { key: 'event_type', question: 'What type of event or project is this? (e.g., wedding, corporate event, music video, brand shoot)' },
  { key: 'date', question: 'When do you need this? (specific date or date range)' },
  { key: 'location', question: 'Where will the shoot take place? (city, venue, or area)' },
  { key: 'budget', question: 'What is your approximate budget range? (e.g., under R5k, R5k-R15k, R15k-R50k, R50k+)' },
  { key: 'deliverables', question: 'What deliverables do you need? (e.g., edited photos, highlight video, full film, raw footage)' },
  { key: 'duration', question: 'How long do you need coverage for? (e.g., 4 hours, full day, multi-day)' },
  { key: 'style', question: 'Do you have a preferred style? (e.g., documentary, cinematic, editorial, candid)' },
] as const;

/**
 * Creates booking-oriented tools for the Booking agent.
 * Includes quote calculation, booking submission, availability check, brief analysis, and social content.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createBookingTools(
  supabase: SupabaseClient,
  isAuthenticated: boolean,
  flags: { smart_productions: boolean } = { smart_productions: false },
  conversationId: string | null = null,
): Record<string, any> {
  const tools: Record<string, any> = {
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
          .from('public_profiles')
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
          profile_url: `/studio/category/photography/${c.crew_slug}`,
        })) };
      },
    },

    get_creator_detail: {
      description:
        'Get full details about a specific creator including their equipment, recent work, and reviews. Pass either crew_slug or creator_id.',
      inputSchema: jsonSchema({
        type: 'object' as const,
        properties: {
          crew_slug: { type: 'string', description: 'The crew slug from the search results' },
          creator_id: { type: 'string', description: 'The creator UUID (use if slug is not available)' },
        },
      }),
      execute: async ({ crew_slug, creator_id }: { crew_slug?: string; creator_id?: string }) => {
        let creator = null;

        const SAFE_COLS = 'id, display_name, crew_slug, avatar_url, crew_bio, bio, specializations, hourly_rate, location, years_experience, crew_featured, skills, social_links, portfolio_projects, is_verified, verification_status, available_for_hire';

        if (crew_slug) {
          const { data } = await supabase
            .from('public_profiles').select(SAFE_COLS)
            .eq('crew_slug', crew_slug).eq('verification_status', 'verified')
            .eq('available_for_hire', true).single();
          creator = data;
        }

        if (!creator && creator_id) {
          const { data } = await supabase
            .from('public_profiles').select(SAFE_COLS)
            .eq('id', creator_id).eq('verification_status', 'verified')
            .eq('available_for_hire', true).single();
          creator = data;
        }

        if (!creator && crew_slug && crew_slug.includes(' ')) {
          const { data } = await supabase
            .from('public_profiles').select(SAFE_COLS)
            .ilike('display_name', `%${escapeIlike(crew_slug)}%`)
            .eq('verification_status', 'verified')
            .eq('available_for_hire', true)
            .limit(1).single();
          creator = data;
        }

        if (!creator) return { error: 'Creator not found or not available.' };

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
          flags.smart_productions
            ? supabase.from('smart_productions').select('id, title, slug, project_type')
                .contains('crew_ids', [creator.id]).limit(5)
            : Promise.resolve({ data: null }),
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
            years_experience: creator.years_experience, profile_url: `/studio/category/photography/${creator.crew_slug}`,
            avg_rating: avgRating, total_reviews: ratings.length,
            available: !isBusy,
            status: isBusy ? 'Currently busy with an active gig' : 'Available for hire',
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          equipment: gear.data?.map((g: any) => ({ title: g.title, rate: g.price, pricing_model: g.pricing_model, category: g.category })) ?? [],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          recent_work: flags.smart_productions
            ? (productions.data?.map((p: any) => ({ title: p.title, type: p.project_type, url: `/studio/${p.slug}` })) ?? [])
            : [],
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
          cancellation_policy: STUDIO.booking.cancellationPolicy,
        };
      },
    },

    create_service_booking: {
      description:
        'Create a paid service booking with a secure gateway payment. ONLY call this after calculate_booking_quote AND the client has explicitly confirmed. Returns a payment URL. Required: project_category, project_description (min 20 chars), deliverables, duration_hours. Optional: creator_id, location, preferred_dates.',
      inputSchema: jsonSchema({
        type: 'object' as const,
        properties: {
          creator_id: { type: 'string', description: 'The creator UUID (from search results or pre-selected production)' },
          project_category: { type: 'string', description: 'The project category used in the quote (e.g. Wedding Photography, Music Video)' },
          project_description: { type: 'string', description: 'What the client needs — min 20 characters' },
          deliverables: { type: 'string', description: 'What the client will receive (e.g. edited photos, highlight video)' },
          duration_hours: { type: 'number', description: 'Number of hours (must match the quote)' },
          location: { type: 'string', description: 'Where the shoot will happen' },
          preferred_dates: { type: 'string', description: 'When the client needs the work done' },
        },
        required: ['project_category', 'project_description', 'deliverables', 'duration_hours'],
      }),
      execute: async (params: {
        creator_id?: string; project_category: string; project_description: string;
        deliverables: string; duration_hours: number; location?: string; preferred_dates?: string;
      }) => {
        if (!isAuthenticated) {
          return { error: 'You must be signed in to book. Please sign in at /login or register at /register first.' };
        }

        if (params.project_description.length < 20) {
          return { error: 'Project description must be at least 20 characters.' };
        }

        if (params.duration_hours < STUDIO.booking.minBookingHours || params.duration_hours > STUDIO.booking.maxBookingHours) {
          return { error: `Duration must be between ${STUDIO.booking.minBookingHours} and ${STUDIO.booking.maxBookingHours} hours.` };
        }

        // Get authenticated user
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          return { error: 'Session expired. Please sign in again at /login.' };
        }

        // Prevent self-booking
        if (params.creator_id && params.creator_id === user.id) {
          return { error: 'You cannot book yourself as a creator.' };
        }

        // Calculate pricing
        const hourlyRate = getHourlyRate(params.project_category);
        const subtotal = Math.round(hourlyRate * params.duration_hours);
        const vat = Math.round(subtotal * (STUDIO.booking.vatRate / 100));
        const total = subtotal + vat;
        const platformAmount = Math.round(total * (STUDIO.booking.platformCommission / 100));
        const creatorAmount = total - platformAmount;

        const reference = `BK-${nanoid(10)}`;
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || STUDIO.meta.url;

        try {
          // Insert booking
          const { data: booking, error } = await admin()
            .from('bookings')
            .insert({
              reference,
              client_id: user.id,
              client_email: user.email,
              creator_id: params.creator_id || null,
              booking_type: 'production',
              project_category: params.project_category,
              project_description: params.project_description,
              deliverables: params.deliverables,
              duration_hours: params.duration_hours,
              location: params.location || null,
              preferred_dates: params.preferred_dates || null,
              subtotal, vat, total,
              platform_commission: STUDIO.booking.platformCommission,
              platform_amount: platformAmount,
              creator_amount: creatorAmount,
              status: 'pending',
              payment_status: 'unpaid',
            })
            .select('id, reference')
            .single();

          if (error || !booking) {
            return { error: 'Failed to create booking. Please try again.' };
          }

          // Create Paystack payment
          if (!payments.isConfigured()) {
            return {
              success: true,
              booking_reference: reference,
              total_zar: total,
              message: `Booking ${reference} created (R${total}). Payment provider not configured — contact admin at ${STUDIO.email}.`,
              dashboard_url: '/dashboard/bookings',
            };
          }

          const { paymentUrl, accessCode } = await payments.createCheckout({
            paymentId: reference,
            amount: total,
            itemName: `Booking: ${params.project_category}`,
            itemDescription: `${params.project_category} — ${params.duration_hours}hrs`,
            email: user.email!,
            returnUrl: `${baseUrl}/api/service-bookings/callback?reference=${reference}`,
            cancelUrl: `${baseUrl}/dashboard/bookings?status=cancelled`,
            metadata: {
              customStr1: 'service_booking',
              customStr2: booking.id,
            },
          });

          await admin()
            .from('bookings')
            .update({ paystack_reference: reference, paystack_access_code: accessCode || null })
            .eq('id', booking.id);

          // Notify admin
          try {
            await emailProvider.sendEmail({
              to: STUDIO.bookingEmail,
              subject: `New booking: ${params.project_category} — ${reference}`,
              text: `A new service booking was created via Ubunye.\n\nReference: ${reference}\nClient: ${user.email}\nCategory: ${params.project_category}\nDuration: ${params.duration_hours} hours\nTotal: R${total}\nCreator: ${params.creator_id || 'Unassigned'}\n\nView in admin: ${baseUrl}/admin/service-bookings`,
            });
          } catch { /* don't block */ }

          logEvent({
            eventType: 'booking_created',
            eventCategory: 'booking',
            userId: user.id,
            metadata: { reference, project_category: params.project_category, duration_hours: params.duration_hours, total, has_creator: !!params.creator_id, source: 'ubunye' },
          });

          if (conversationId) {
            markConversion({
              conversationId,
              convertedTo: 'booking',
              convertedRef: reference,
            });
          }

          const payUrl = `${baseUrl}/dashboard/bookings/pay?ref=${encodeURIComponent(reference)}`;

          return {
            success: true,
            booking_reference: reference,
            total_zar: total,
            payment_url: payUrl,
            paystack_redirect: paymentUrl,
            message: `Booking created! Reference: ${reference}. Total: R${total}. Complete payment to confirm your booking.`,
            dashboard_url: '/dashboard/bookings',
          };
        } catch {
          return { error: 'Failed to create booking. Please try again.' };
        }
      },
    },

    check_availability: {
      description:
        'Check equipment booking availability for a specific date range. Call this when a user wants to know if gear is available for rent on specific dates.',
      inputSchema: jsonSchema({
        type: 'object' as const,
        properties: {
          rental_id: { type: 'string', description: 'The smart_rental UUID to check availability for' },
          start_date: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
          end_date: { type: 'string', description: 'End date in YYYY-MM-DD format' },
        },
        required: ['rental_id', 'start_date', 'end_date'],
      }),
      execute: async ({ rental_id, start_date, end_date }: {
        rental_id: string; start_date: string; end_date: string;
      }) => {
        // Get the rental item
        const { data: rental, error: rentalError } = await supabase
          .from('smart_rentals')
          .select('id, title, brand, model, is_available, price_per_day, price_per_week, deposit_amount, quantity')
          .eq('id', rental_id)
          .eq('is_published', true)
          .is('deleted_at', null)
          .single();

        if (rentalError || !rental) {
          return { error: 'Equipment item not found.' };
        }

        if (!rental.is_available) {
          return {
            available: false,
            item: `${rental.title} (${rental.brand} ${rental.model})`,
            reason: 'This item is currently marked as unavailable by the owner.',
          };
        }

        // Check for overlapping bookings
        const { data: overlapping } = await supabase
          .from('equipment_bookings')
          .select('id, start_date, end_date, status')
          .eq('rental_id', rental_id)
          .in('status', ['confirmed', 'paid', 'active'])
          .or(`and(start_date.lte.${end_date},end_date.gte.${start_date})`);

        const totalQuantity = rental.quantity ?? 1;
        const bookedCount = overlapping?.length ?? 0;
        const isAvailable = bookedCount < totalQuantity;

        // Calculate pricing
        const startD = new Date(start_date);
        const endD = new Date(end_date);
        const days = Math.max(1, Math.ceil((endD.getTime() - startD.getTime()) / (1000 * 60 * 60 * 24)));
        const useWeekly = days >= 7 && rental.price_per_week;
        const weeks = Math.floor(days / 7);
        const remainingDays = days % 7;
        const totalPrice = useWeekly
          ? (weeks * rental.price_per_week) + (remainingDays * rental.price_per_day)
          : days * rental.price_per_day;

        return {
          available: isAvailable,
          item: `${rental.title} (${rental.brand} ${rental.model})`,
          dates: { start: start_date, end: end_date, days },
          pricing: {
            price_per_day: rental.price_per_day,
            price_per_week: rental.price_per_week,
            total_price: totalPrice,
            deposit: rental.deposit_amount,
            currency: 'ZAR',
          },
          ...(isAvailable
            ? { message: `Available for the requested dates. Total: R${totalPrice} + R${rental.deposit_amount} deposit.` }
            : { message: 'Not available for the requested dates. All units are booked during this period.' }),
        };
      },
    },

    improve_brief: {
      description:
        'Analyze a client brief and identify missing information. Call this when a client describes a project but their brief is vague or incomplete.',
      inputSchema: jsonSchema({
        type: 'object' as const,
        properties: {
          brief_text: { type: 'string', description: 'The client\'s project description or brief as they described it' },
        },
        required: ['brief_text'],
      }),
      execute: async ({ brief_text }: { brief_text: string }) => {
        const lower = brief_text.toLowerCase();
        const missingFields: { field: string; question: string }[] = [];

        const hasEventType = /wedding|corporate|music.?video|brand|portrait|event|documentary|commercial|matric|lobola|umembeso|graduation|birthday|funeral|conference/.test(lower);
        if (!hasEventType) missingFields.push({ field: 'event_type', question: BRIEF_REQUIRED_FIELDS[0].question });

        const hasDate = /\d{1,2}[\s/.-]\w+[\s/.-]\d{2,4}|january|february|march|april|may|june|july|august|september|october|november|december|next\s+\w+|this\s+\w+|tomorrow|weekend/.test(lower);
        if (!hasDate) missingFields.push({ field: 'date', question: BRIEF_REQUIRED_FIELDS[1].question });

        const hasLocation = /johannesburg|joburg|jozi|pretoria|cape\s?town|durban|bloemfontein|port\s?elizabeth|gqeberha|east\s?london|soweto|sandton|midrand|centurion|rosebank|studio|outdoor|venue|church|hotel/.test(lower);
        if (!hasLocation) missingFields.push({ field: 'location', question: BRIEF_REQUIRED_FIELDS[2].question });

        const hasBudget = /r\s?\d|budget|afford|cost|price|spend|thousand|k\b|rand/.test(lower);
        if (!hasBudget) missingFields.push({ field: 'budget', question: BRIEF_REQUIRED_FIELDS[3].question });

        const hasDeliverables = /photo|video|film|edit|raw|highlight|reel|album|gallery|footage|drone|aerial/.test(lower);
        if (!hasDeliverables) missingFields.push({ field: 'deliverables', question: BRIEF_REQUIRED_FIELDS[4].question });

        const hasDuration = /\d+\s*hours?|half.?day|full.?day|multi.?day|whole\s+day|morning|afternoon|all\s+day/.test(lower);
        if (!hasDuration) missingFields.push({ field: 'duration', question: BRIEF_REQUIRED_FIELDS[5].question });

        const hasStyle = /cinematic|documentary|editorial|candid|moody|bright|natural|creative|traditional|modern|vintage/.test(lower);
        if (!hasStyle) missingFields.push({ field: 'style', question: BRIEF_REQUIRED_FIELDS[6].question });

        const completenessScore = Math.round(((BRIEF_REQUIRED_FIELDS.length - missingFields.length) / BRIEF_REQUIRED_FIELDS.length) * 100);

        const serviceTypes = ['photography', 'cinematography', 'postProduction'] as const;
        const matchedCategory = serviceTypes.find(s => lower.includes(s.toLowerCase()))
          ?? (/(photo|headshot|portrait|product|brand)/.test(lower) ? 'photography' : null)
          ?? (/(video|film|cinema|drone|music.?video|corporate.?video)/.test(lower) ? 'cinematography' : null)
          ?? (/(edit|retouch|grade|colour|color|vfx|sfx)/.test(lower) ? 'postProduction' : null);

        return {
          completeness_score: completenessScore,
          status: completenessScore >= 70 ? 'good' : completenessScore >= 40 ? 'needs_more_info' : 'very_incomplete',
          detected_fields: BRIEF_REQUIRED_FIELDS.length - missingFields.length,
          total_fields: BRIEF_REQUIRED_FIELDS.length,
          missing_fields: missingFields,
          suggested_category: matchedCategory || null,
          tip: completenessScore >= 70
            ? 'Brief looks solid — you can proceed to quoting.'
            : `Ask the client the ${missingFields.length} question(s) above to build a complete brief. A complete brief leads to better quotes and fewer revisions.`,
        };
      },
    },

    generate_social_content: {
      description:
        'Generate social media post content from a completed production. Call this when admin or a creator wants to create social posts for Instagram, Twitter/X, or LinkedIn.',
      inputSchema: jsonSchema({
        type: 'object' as const,
        properties: {
          production_slug: { type: 'string', description: 'The slug of the smart_production to generate content for' },
          platforms: {
            type: 'array',
            items: { type: 'string' },
            description: 'Target platforms: instagram, twitter, linkedin. Defaults to all three.',
          },
          tone: { type: 'string', description: 'Tone: professional, casual, hype, storytelling. Defaults to professional.' },
        },
        required: ['production_slug'],
      }),
      execute: async ({ production_slug, platforms, tone }: {
        production_slug: string; platforms?: string[]; tone?: string;
      }) => {
        const { data: production, error } = await supabase
          .from('smart_productions')
          .select('title, description, project_type, sub_category, tags, year, client')
          .eq('slug', production_slug)
          .eq('is_published', true)
          .is('deleted_at', null)
          .single();

        if (error || !production) {
          return { error: 'Production not found or not published.' };
        }

        const targetPlatforms = platforms ?? ['instagram', 'twitter', 'linkedin'];
        const contentTone = tone ?? 'professional';
        const tags = (production.tags ?? []) as string[];
        const hashtags = [
          '#ThabangVision',
          '#SouthAfricanCreatives',
          `#${(production.project_type ?? '').replace(/\s+/g, '')}`,
          ...tags.slice(0, 3).map((t: string) => `#${t.replace(/\s+/g, '')}`),
        ].join(' ');

        const posts: Record<string, { text: string; character_count: number; hashtags: string }> = {};
        const productionUrl = `${STUDIO.meta.url}/studio/${production_slug}`;

        if (targetPlatforms.includes('instagram')) {
          const caption = contentTone === 'hype'
            ? `${production.title} just dropped. This ${production.project_type} project hit different.\n\n${production.description?.slice(0, 200) ?? ''}\n\nSee the full project — link in bio.\n\n${hashtags}`
            : contentTone === 'storytelling'
            ? `Behind every frame is a story. "${production.title}" — a ${production.project_type} project${production.client ? ` for ${production.client}` : ''}${production.year ? ` (${production.year})` : ''}.\n\n${production.description?.slice(0, 200) ?? ''}\n\nFull project on our website — link in bio.\n\n${hashtags}`
            : `${production.title} — ${production.project_type}${production.client ? ` | ${production.client}` : ''}${production.year ? ` (${production.year})` : ''}\n\n${production.description?.slice(0, 200) ?? ''}\n\nView the full project — link in bio.\n\n${hashtags}`;

          posts.instagram = { text: caption, character_count: caption.length, hashtags };
        }

        if (targetPlatforms.includes('twitter')) {
          const tweet = contentTone === 'hype'
            ? `${production.title} is LIVE.\n\n${production.project_type}${production.client ? ` for ${production.client}` : ''}.\n\n${productionUrl}\n\n${hashtags.split(' ').slice(0, 3).join(' ')}`
            : `New work: "${production.title}" — ${production.project_type}${production.year ? ` (${production.year})` : ''}\n\n${productionUrl}\n\n${hashtags.split(' ').slice(0, 3).join(' ')}`;

          posts.twitter = { text: tweet, character_count: tweet.length, hashtags: hashtags.split(' ').slice(0, 3).join(' ') };
        }

        if (targetPlatforms.includes('linkedin')) {
          const post = `Proud to share our latest ${production.project_type} production: "${production.title}"${production.client ? ` for ${production.client}` : ''}${production.year ? ` (${production.year})` : ''}.\n\n${production.description?.slice(0, 300) ?? ''}\n\nAt ${STUDIO.name}, we bring creative visions to life through world-class production.\n\n${productionUrl}\n\n${hashtags}`;

          posts.linkedin = { text: post, character_count: post.length, hashtags };
        }

        return {
          production_title: production.title,
          project_type: production.project_type,
          tone: contentTone,
          posts,
          tip: 'Copy-paste these posts to your social accounts. Add your best photo/video from the production as the media.',
        };
      },
    },
  };

  if (!flags.smart_productions) {
    delete tools.generate_social_content;
  }

  return tools;
}
