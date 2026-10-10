// ─── PostgREST ilike escaping ────────────────────────────────────────────────

/**
 * Escape special characters for PostgREST ilike filters.
 * Prevents filter injection via %, _, and backslash characters.
 */
export function escapeIlike(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

// ─── PostgREST or=() / filter-string terms ──────────────────────────────────

/**
 * A free-text term (from a person or a model) made safe to splice into a
 * PostgREST filter STRING such as `.or('title.ilike.%term%,brand.ilike...')`.
 * escapeIlike alone left `,` `.` `(` `)` `"` `'` and `*`: a comma in a chat
 * search term added extra OR conditions (Phase 6 security INJ-7), and PostgREST
 * reads `*` as a wildcard. They are replaced by spaces (as /api/search strips
 * them), whitespace is collapsed and the term is capped in length.
 */
export const FILTER_TERM_MAX_LENGTH = 100;

export function sanitizeFilterTerm(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[,.()"'*\\:\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, FILTER_TERM_MAX_LENGTH);
}

/** `%term%` for an ilike inside a filter string, or null when nothing is left to search for. */
export function filterIlikePattern(input: unknown): string | null {
  const term = sanitizeFilterTerm(input);
  return term ? `%${escapeIlike(term)}%` : null;
}

// ─── Search Provider Abstraction ─────────────────────────────────────────────

export type SearchResultItem = {
  id: string;
  title: string;
  excerpt: string;
  category: 'productions' | 'equipment' | 'press' | 'careers' | 'creators' | 'community-gear';
  thumbnail: string | null;
  href: string;
};

export type SearchResponse = {
  results: SearchResultItem[];
  counts: Record<string, number>;
};

export type SearchOptions = {
  /** Maximum results per category (default 8) */
  limitPerCategory?: number;
};

/**
 * Unified search provider interface.
 *
 * Each provider implements these methods. The active provider is
 * selected via `SEARCH_PROVIDER` env var in `lib/search/index.ts`.
 */
export interface SearchProvider {
  /** Provider identifier (e.g., 'supabase', 'algolia') */
  readonly name: string;

  /** Whether the provider has valid credentials configured. */
  isConfigured(): boolean;

  /**
   * Search across all content types.
   *
   * @param query - Sanitized search query (already stripped of special chars)
   * @param options - Optional search parameters
   */
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
}
