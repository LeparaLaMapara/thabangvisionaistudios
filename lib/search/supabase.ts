import { createClient } from '@/lib/supabase/server';
import type {
  SearchProvider,
  SearchResultItem,
  SearchResponse,
  SearchOptions,
} from './types';

// ─── Supabase Search Provider ───────────────────────────────────────────────

function truncate(text: string, max = 120): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

export const supabaseSearch: SearchProvider = {
  name: 'supabase',

  isConfigured(): boolean {
    return !!(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
  },

  async search(query: string, options?: SearchOptions): Promise<SearchResponse> {
    const limit = options?.limitPerCategory ?? 8;
    const pattern = `%${query}%`;

    const supabase = await createClient();

    const [productions, rentals, press, careers, profiles, listings] = await Promise.all([
      supabase
        .from('smart_productions')
        .select('id, slug, title, client, description, tags, thumbnail_url')
        .is('deleted_at', null)
        .eq('is_published', true)
        .or(`title.ilike.${pattern},client.ilike.${pattern},description.ilike.${pattern}`)
        .limit(limit),

      supabase
        .from('smart_rentals')
        .select('id, slug, title, brand, model, description, category, thumbnail_url')
        .is('deleted_at', null)
        .eq('is_published', true)
        .or(`title.ilike.${pattern},brand.ilike.${pattern},model.ilike.${pattern},description.ilike.${pattern}`)
        .limit(limit),

      supabase
        .from('press')
        .select('id, slug, title, excerpt, author, cover_url')
        .is('deleted_at', null)
        .eq('is_published', true)
        .or(`title.ilike.${pattern},excerpt.ilike.${pattern},author.ilike.${pattern}`)
        .limit(limit),

      supabase
        .from('careers')
        .select('id, title, department, location, description')
        .is('deleted_at', null)
        .eq('is_published', true)
        .or(`title.ilike.${pattern},department.ilike.${pattern},location.ilike.${pattern},description.ilike.${pattern}`)
        .limit(limit),

      supabase
        .from('profiles')
        .select('id, display_name, bio, avatar_url, skills')
        .or(`display_name.ilike.${pattern},bio.ilike.${pattern}`)
        .limit(limit),

      supabase
        .from('listings')
        .select('id, slug, title, description, category, thumbnail_url')
        .is('deleted_at', null)
        .eq('is_published', true)
        .or(`title.ilike.${pattern},description.ilike.${pattern},category.ilike.${pattern}`)
        .limit(limit),
    ]);

    const results: SearchResultItem[] = [];

    for (const p of productions.data ?? []) {
      results.push({
        id: p.id,
        title: p.title,
        excerpt: truncate(p.description || `Client: ${p.client || '—'}`),
        category: 'productions',
        thumbnail: p.thumbnail_url,
        href: `/smart-production/${p.slug}`,
      });
    }

    for (const r of rentals.data ?? []) {
      results.push({
        id: r.id,
        title: r.title,
        excerpt: truncate(r.description || [r.brand, r.model].filter(Boolean).join(' ')),
        category: 'equipment',
        thumbnail: r.thumbnail_url,
        href: `/smart-rentals/${r.category}/${r.slug}`,
      });
    }

    for (const a of press.data ?? []) {
      results.push({
        id: a.id,
        title: a.title,
        excerpt: truncate(a.excerpt || ''),
        category: 'press',
        thumbnail: a.cover_url,
        href: `/press/${a.slug}`,
      });
    }

    for (const c of careers.data ?? []) {
      results.push({
        id: c.id,
        title: c.title,
        excerpt: truncate(c.description || [c.department, c.location].filter(Boolean).join(' · ')),
        category: 'careers',
        thumbnail: null,
        href: '/careers',
      });
    }

    for (const p of profiles.data ?? []) {
      results.push({
        id: p.id,
        title: p.display_name || 'Creator',
        excerpt: truncate(p.bio || (p.skills as string[] | null)?.join(', ') || ''),
        category: 'creators',
        thumbnail: p.avatar_url,
        href: `/creators/${p.id}`,
      });
    }

    for (const l of listings.data ?? []) {
      results.push({
        id: l.id,
        title: l.title,
        excerpt: truncate(l.description || l.category || ''),
        category: 'community-gear',
        thumbnail: l.thumbnail_url,
        href: `/marketplace/${l.slug}`,
      });
    }

    const counts: Record<string, number> = {};
    for (const r of results) {
      counts[r.category] = (counts[r.category] || 0) + 1;
    }

    return { results, counts };
  },
};
