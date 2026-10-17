import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';

export const FEATURE_KEYS = [
  'smart_productions',
  'smart_productions_booking',
  'studio_crews',
  'voice_onboarding',
  'ai_rate_suggestions',
  'ai_portfolio_tagging',
  // Phase 4: automated third-party courier delivery. Off by default; turning it
  // on still needs verified cover and a non-zero
  // DELIVERY_POLICY.automatedDeliveryMaxItemValueCents (lib/core/delivery/policy.ts).
  'delivery_courier',
  // Ubunye Apps (/tools): shows "Apps" in the main nav. The page is
  // reachable by URL either way; the flag only controls the nav entry.
  'creative_tools',
  // Many roles, honest proof (TASK-085): the two journeys, Find and Offer, on
  // the home hero and /welcome; /find, /offer and /people. Off (or absent) in
  // production until the owner switches it on: today's behaviour unchanged.
  'roles_v1',
  // Ubunye plans (Slice C, migration 097): a multi-part outcome saved as a
  // plan the client approves, /dashboard/plans. Off on production until the
  // owner switches it on; untested features stay off.
  'ubunye_projects',
] as const;

export type FeatureKey = typeof FEATURE_KEYS[number];

const FLAG_DEFAULTS: Partial<Record<FeatureKey, boolean>> = {
  smart_productions: true,
  ai_rate_suggestions: true,
  ai_portfolio_tagging: true,
  delivery_courier: false,
  creative_tools: false,
  roles_v1: false,
  ubunye_projects: false,
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

/**
 * Flags forced on for ONE deployment: FEATURE_FLAGS_FORCE_ON=ubunye_projects,...
 * Flags live in the database, which a hidden production test copy shares with
 * the live site, so switching a flag there would switch it for every
 * customer. This env var is set only on that one deployment (vercel deploy
 * -e), never in the project's environment variables. It can only turn a
 * known flag on, never off.
 */
export function forcedOnFlags(raw: string | undefined = process.env.FEATURE_FLAGS_FORCE_ON): Set<FeatureKey> {
  return new Set((raw ?? '').split(',').map((s) => s.trim()).filter(isFeatureKey));
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
  const forced = forcedOnFlags();
  const flags = await getAllFlagsCached();
  return forced.size ? flags.map((f) => (forced.has(f.key) ? { ...f, enabled: true } : f)) : flags;
}

export async function getFlag(key: FeatureKey): Promise<boolean> {
  if (forcedOnFlags().has(key)) return true;
  const flags = await getAllFlagsCached();
  const row = flags.find((f) => f.key === key);
  return row?.enabled ?? (FLAG_DEFAULTS[key] ?? false);
}

export async function getFlags(
  keys: readonly FeatureKey[],
): Promise<Record<FeatureKey, boolean>> {
  const flags = await getAllFlagsCached();
  const forced = forcedOnFlags();
  const out = {} as Record<FeatureKey, boolean>;
  for (const key of keys) {
    out[key] = forced.has(key) || (flags.find((f) => f.key === key)?.enabled ?? (FLAG_DEFAULTS[key] ?? false));
  }
  return out;
}

export async function setFlag(
  key: FeatureKey,
  enabled: boolean,
  changedBy?: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from('feature_flags')
    .update({ enabled })
    .eq('key', key);

  if (error) throw new Error(`Failed to toggle flag ${key}: ${error.message}`);

  // The audit trigger records auth.uid(), which is empty for this service-role
  // write, so the event row it just made is stamped with the admin here.
  if (changedBy) {
    const { error: auditError } = await supabase
      .from('feature_flag_events')
      .update({ changed_by: changedBy })
      .eq('flag_key', key)
      .is('changed_by', null)
      .gte('changed_at', new Date(Date.now() - 60_000).toISOString());
    if (auditError) console.error(`[features] could not record who changed ${key}:`, auditError.message);
  }
}

export const FEATURE_FLAGS_CACHE_TAG = FLAGS_CACHE_TAG;
