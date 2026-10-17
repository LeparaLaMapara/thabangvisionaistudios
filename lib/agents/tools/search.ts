import { sanitiseForPrompt } from '@/lib/ubunye/sanitise';
import { jsonSchema } from 'ai';
import { escapeIlike, filterIlikePattern } from '@/lib/search/types';
import { getBusyCreatorIds } from '@/lib/supabase/queries/crew';
import { creatorProfilePath } from '@/lib/seo/creator-url';
import { RENTAL_CATEGORIES, RENTAL_CATEGORY_VALUES, STUDIO } from '@/lib/constants';
import { meetsLeadTime, leadTimeMessage } from '@/lib/rental/leadTime';
import { isIsoDate, resolveDate, saToday } from '@/lib/dates/johannesburg';
import { whatsappLink } from '@/lib/payments/eft';

/** The category filter's description, from the real slugs (it used to list ones that do not exist). */
export const GEAR_CATEGORY_HELP = `Rental category slug, one of: ${RENTAL_CATEGORIES.map((c) => `${c.value} (${c.label})`).join(', ')}. "studios" is the studio, booked by full days.`;

/**
 * Whether a hire starting on this date gives the notice checkout enforces
 * (STUDIO.rental.minLeadTimeHours, lib/rental/leadTime.ts). Null when no date
 * was given; otherwise the date read and, when too soon, the words and a
 * prefilled WhatsApp link.
 */
export function gearNotice(startDate: unknown, now: Date = new Date(), what = 'gear'): { start_date: string; too_soon: boolean; message: string | null; whatsapp_url: string | null } | null {
  if (typeof startDate !== 'string' || !startDate.trim()) return null;
  const iso = isIsoDate(startDate.trim()) ? startDate.trim() : resolveDate(startDate, now)?.iso;
  if (!iso) return null;
  if (iso < saToday(now)) return { start_date: iso, too_soon: true, message: 'That date has passed.', whatsapp_url: null };
  // The same call checkout makes (app/api/cart/checkout), so the answer matches what is enforced.
  const ok = meetsLeadTime(iso, now);
  if (ok) return { start_date: iso, too_soon: false, message: null, whatsapp_url: null };
  return {
    start_date: iso,
    too_soon: true,
    message: `${leadTimeMessage(now)} For something sooner, WhatsApp us and we will tell you honestly whether it can be done.`,
    whatsapp_url: whatsappLink(`Hi, I need ${what} on ${iso}. Is anything possible at short notice?`),
  };
}

// ─── Search Tools for Assistant Agent ─────────────────────────────────────────
// Tools focused on searching and browsing platform data.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

/**
 * Creates search-oriented tools for the Assistant agent.
 * Includes creator search, gear search, production search, and press search.
 */
export function createSearchTools(
  supabase: SupabaseClient,
  flags: { smart_productions: boolean } = { smart_productions: false },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {
    search_creators: {
      description:
        'Search for verified, available-for-hire creators on the platform. Call this when a client describes what kind of creative professional they need.',
      inputSchema: jsonSchema({
        type: 'object' as const,
        properties: {
          specialization: { type: 'string', description: 'Type of work: photography, cinematography, editing, sound, directing' },
          location: { type: 'string', description: 'City or area in Gauteng, e.g. johannesburg, pretoria, soweto' },
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
        if (error) return { error: 'Search is unavailable just now.' };
        if (!data || data.length === 0) return { results: [], message: 'No creators found matching your criteria.' };

        const busyIds = await getBusyCreatorIds(supabase, data.map((c: { id: string }) => c.id));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { results: data.map((c: any) => ({
          id: c.id, name: sanitiseForPrompt(c.display_name), slug: c.crew_slug,
          specializations: c.specializations, hourly_rate: c.hourly_rate,
          location: c.location, years_experience: c.years_experience,
          featured: c.crew_featured, bio: sanitiseForPrompt(c.crew_bio, 400),
          available: !busyIds.has(c.id),
          profile_url: creatorProfilePath(c),
        })) };
      },
    },

    search_gear: {
      description:
        'Search equipment available for rental on the platform. Call this when a user asks about available gear, cameras, lenses, lighting, audio, or any equipment.',
      inputSchema: jsonSchema({
        type: 'object' as const,
        properties: {
          category: { type: 'string', enum: [...RENTAL_CATEGORY_VALUES], description: GEAR_CATEGORY_HELP },
          start_date: { type: 'string', description: `The first hire day, YYYY-MM-DD or the customer's words ("tomorrow", "Friday"), to check the ${STUDIO.rental.minLeadTimeHours}-hour notice.` },
          max_price_per_day: { type: 'number', description: 'Maximum daily rental price in ZAR' },
          search_term: { type: 'string', description: 'Search term to match against title, brand, or model' },
        },
      }),
      // No place filter: gear has no location column (it is collected or
      // delivered across Gauteng), so a "location" from the model is ignored.
      execute: async ({ category, max_price_per_day, search_term, start_date }: {
        category?: string; max_price_per_day?: number; search_term?: string; start_date?: string;
      }) => {
        const notice = gearNotice(start_date, new Date(), category === 'studios' ? 'the studio' : 'gear');
        let query = supabase
          .from('smart_rentals')
          .select('id, title, brand, model, price_per_day, price_per_week, deposit_amount, is_available, category, slug, description')
          .eq('is_published', true)
          .is('deleted_at', null)
          .order('price_per_day', { ascending: true })
          .limit(10);

        if (category) query = query.eq('category', category);
        if (max_price_per_day) query = query.lte('price_per_day', max_price_per_day);
        const gearPattern = filterIlikePattern(search_term);
        if (gearPattern) query = query.or(`title.ilike.${gearPattern},brand.ilike.${gearPattern},model.ilike.${gearPattern}`);

        const { data, error } = await query;
        if (error) return { error: 'Search is unavailable just now.' };
        if (!data || data.length === 0) return { results: [], message: 'No equipment found matching your criteria.', notice };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { notice, results: data.map((g: any) => ({
          id: g.id, title: sanitiseForPrompt(g.title), brand: sanitiseForPrompt(g.brand, 60), model: sanitiseForPrompt(g.model, 80),
          price_per_day: g.price_per_day, price_per_week: g.price_per_week,
          deposit: g.deposit_amount, available: g.is_available,
          category: g.category, url: `/rentals/${g.category}/${g.slug}`,
        })) };
      },
    },

    search_productions: {
      description:
        'Search completed productions and portfolio work on the platform. Call this when a user asks about past projects, portfolio, or example work.',
      inputSchema: jsonSchema({
        type: 'object' as const,
        properties: {
          project_type: { type: 'string', description: 'Type of production: wedding, corporate, music_video, documentary, commercial, short_film, event' },
          search_term: { type: 'string', description: 'Search term to match against title, client, or description' },
        },
      }),
      execute: async ({ project_type, search_term }: {
        project_type?: string; search_term?: string;
      }) => {
        let query = supabase
          .from('smart_productions')
          .select('id, title, client, project_type, year, description, slug, sub_category')
          .eq('is_published', true)
          .is('deleted_at', null)
          .order('year', { ascending: false })
          .limit(10);

        if (project_type) query = query.ilike('project_type', `%${escapeIlike(project_type)}%`);
        const workPattern = filterIlikePattern(search_term);
        if (workPattern) query = query.or(`title.ilike.${workPattern},client.ilike.${workPattern},description.ilike.${workPattern}`);

        const { data, error } = await query;
        if (error) return { error: 'Search is unavailable just now.' };
        if (!data || data.length === 0) return { results: [], message: 'No productions found matching your criteria.' };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { results: data.map((p: any) => ({
          id: p.id, title: sanitiseForPrompt(p.title), client: sanitiseForPrompt(p.client, 80),
          project_type: p.project_type, year: p.year,
          description: sanitiseForPrompt(p.description, 200),
          url: `/studio/${p.slug}`,
        })) };
      },
    },

    search_press: {
      description:
        'Search press articles and news about the studio. Call this when a user asks about news, articles, or media coverage.',
      inputSchema: jsonSchema({
        type: 'object' as const,
        properties: {
          search_term: { type: 'string', description: 'Search term to match against title or excerpt' },
        },
      }),
      execute: async ({ search_term }: { search_term?: string }) => {
        let query = supabase
          .from('press')
          .select('id, title, excerpt, published_at, slug')
          .eq('is_published', true)
          .is('deleted_at', null)
          .order('published_at', { ascending: false })
          .limit(10);

        const pressPattern = filterIlikePattern(search_term);
        if (pressPattern) query = query.or(`title.ilike.${pressPattern},excerpt.ilike.${pressPattern}`);

        const { data, error } = await query;
        if (error) return { error: 'Search is unavailable just now.' };
        if (!data || data.length === 0) return { results: [], message: 'No press articles found.' };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { results: data.map((p: any) => ({
          id: p.id, title: sanitiseForPrompt(p.title), excerpt: sanitiseForPrompt(p.excerpt, 300),
          published_at: p.published_at, url: `/press/${p.slug}`,
        })) };
      },
    },
  };

  if (!flags.smart_productions) {
    delete tools.search_productions;
  }

  return tools;
}
