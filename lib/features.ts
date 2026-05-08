import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';

export const FEATURE_KEYS = [
  'smart_productions',
  'smart_productions_booking',
  'studio_crews',
  'voice_onboarding',
  'ai_rate_suggestions',
  'ai_portfolio_tagging',
] as const;

export type FeatureKey = typeof FEATURE_KEYS[number];

const FLAG_DEFAULTS: Partial<Record<FeatureKey, boolean>> = {
  smart_productions: true,
  ai_rate_suggestions: true,
  ai_portfolio_tagging: true,
};

export interface FeatureFlag {
  key: FeatureKey;
  enabled: boolean;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
}

const FLAGS_CACHE_TAG = 'feature-flags';
const FLAGS_CACHE_TTL_SECONDS = 60;

export function isFeatureKey(key: string): key is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(key);
}

async function readAllFlagsFromDb(): Promise<FeatureFlag[]> {
  // Use admin client so the cached fn doesn't read cookies.
  // Flags are globally readable (RLS "anyone_reads_flags") — service role
  // just sidesteps the cookie access that unstable_cache forbids.
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('feature_flags')
    .select('key, enabled, description, updated_at, updated_by')
    .order('key');

  if (error || !data) return [];
  return data.filter((row): row is FeatureFlag => isFeatureKey(row.key));
}

const getAllFlagsCached = unstable_cache(
  readAllFlagsFromDb,
  ['feature-flags-all'],
  { revalidate: FLAGS_CACHE_TTL_SECONDS, tags: [FLAGS_CACHE_TAG] },
);

export async function getAllFlags(): Promise<FeatureFlag[]> {
  return getAllFlagsCached();
}

export async function getFlag(key: FeatureKey): Promise<boolean> {
  const flags = await getAllFlagsCached();
  const row = flags.find((f) => f.key === key);
  return row?.enabled ?? (FLAG_DEFAULTS[key] ?? false);
}

export async function getFlags(
  keys: readonly FeatureKey[],
): Promise<Record<FeatureKey, boolean>> {
  const flags = await getAllFlagsCached();
  const out = {} as Record<FeatureKey, boolean>;
  for (const key of keys) {
    out[key] = flags.find((f) => f.key === key)?.enabled ?? (FLAG_DEFAULTS[key] ?? false);
  }
  return out;
}

export async function setFlag(
  key: FeatureKey,
  enabled: boolean,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('feature_flags')
    .update({ enabled })
    .eq('key', key);

  if (error) throw new Error(`Failed to toggle flag ${key}: ${error.message}`);
}

export const FEATURE_FLAGS_CACHE_TAG = FLAGS_CACHE_TAG;
