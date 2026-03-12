import type { SearchProvider } from './types';
import { supabaseSearch } from './supabase';

// Re-export types for convenience
export type {
  SearchProvider,
  SearchResultItem,
  SearchResponse,
  SearchOptions,
} from './types';

// ─── Provider Registry ───────────────────────────────────────────────────────

const providers: Record<string, SearchProvider> = {
  supabase: supabaseSearch,
};

// ─── Active Provider ─────────────────────────────────────────────────────────

const providerName = (process.env.SEARCH_PROVIDER ?? 'supabase').toLowerCase();

if (!providers[providerName]) {
  console.warn(
    `[search] Unknown SEARCH_PROVIDER="${providerName}". Falling back to supabase. ` +
    `Valid options: ${Object.keys(providers).join(', ')}`,
  );
}

/**
 * The active search provider, determined by `SEARCH_PROVIDER` env var.
 * Defaults to Supabase if not set or unrecognized.
 */
export const search: SearchProvider = providers[providerName] ?? supabaseSearch;
