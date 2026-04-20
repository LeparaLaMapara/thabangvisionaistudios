import { jsonSchema } from 'ai';
import { escapeIlike } from '@/lib/search/types';

// ─── Search Tools for Assistant Agent ─────────────────────────────────────────
// Tools focused on searching and browsing platform data.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

/**
 * Creates search-oriented tools for the Assistant agent.
 * Includes creator search, gear search, production search, and press search.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSearchTools(
  supabase: SupabaseClient,
  flags: { smart_productions: boolean } = { smart_productions: false },
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
          profile_url: `/smart-rentals/crew-services/${c.crew_slug}`,
        })) };
      },
    },

    search_gear: {
      description:
        'Search equipment available for rental on the platform. Call this when a user asks about available gear, cameras, lenses, lighting, audio, or any equipment.',
      inputSchema: jsonSchema({
        type: 'object' as const,
        properties: {
          category: { type: 'string', description: 'Equipment category: cameras-optics, lighting, audio, grip-support, drones, accessories' },
          location: { type: 'string', description: 'City or area' },
          max_price_per_day: { type: 'number', description: 'Maximum daily rental price in ZAR' },
          search_term: { type: 'string', description: 'Search term to match against title, brand, or model' },
        },
      }),
      execute: async ({ category, location, max_price_per_day, search_term }: {
        category?: string; location?: string; max_price_per_day?: number; search_term?: string;
      }) => {
        let query = supabase
          .from('smart_rentals')
          .select('id, title, brand, model, price_per_day, price_per_week, deposit_amount, is_available, category, slug, description')
          .eq('is_published', true)
          .is('deleted_at', null)
          .order('price_per_day', { ascending: true })
          .limit(10);

        if (category) query = query.eq('category', category);
        if (max_price_per_day) query = query.lte('price_per_day', max_price_per_day);
        if (search_term) query = query.or(`title.ilike.%${escapeIlike(search_term)}%,brand.ilike.%${escapeIlike(search_term)}%,model.ilike.%${escapeIlike(search_term)}%`);
        if (location) query = query.ilike('location', `%${escapeIlike(location)}%`);

        const { data, error } = await query;
        if (error) return { error: error.message };
        if (!data || data.length === 0) return { results: [], message: 'No equipment found matching your criteria.' };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { results: data.map((g: any) => ({
          id: g.id, title: g.title, brand: g.brand, model: g.model,
          price_per_day: g.price_per_day, price_per_week: g.price_per_week,
          deposit: g.deposit_amount, available: g.is_available,
          category: g.category, url: `/smart-rentals/${g.category}/${g.slug}`,
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
        if (search_term) query = query.or(`title.ilike.%${escapeIlike(search_term)}%,client.ilike.%${escapeIlike(search_term)}%,description.ilike.%${escapeIlike(search_term)}%`);

        const { data, error } = await query;
        if (error) return { error: error.message };
        if (!data || data.length === 0) return { results: [], message: 'No productions found matching your criteria.' };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { results: data.map((p: any) => ({
          id: p.id, title: p.title, client: p.client,
          project_type: p.project_type, year: p.year,
          description: p.description?.slice(0, 200),
          url: `/smart-production/${p.slug}`,
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

        if (search_term) query = query.or(`title.ilike.%${escapeIlike(search_term)}%,excerpt.ilike.%${escapeIlike(search_term)}%`);

        const { data, error } = await query;
        if (error) return { error: error.message };
        if (!data || data.length === 0) return { results: [], message: 'No press articles found.' };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { results: data.map((p: any) => ({
          id: p.id, title: p.title, excerpt: p.excerpt,
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
