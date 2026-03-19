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
