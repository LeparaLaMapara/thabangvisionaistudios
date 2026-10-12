'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { FEATURE_FLAGS_CACHE_TAG, isFeatureKey, setFlag } from '@/lib/features';

export async function toggleFlag(key: string, enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireAdmin();
  if (auth.error) return { ok: false, error: 'Not authorized.' };

  if (!isFeatureKey(key)) return { ok: false, error: `Unknown flag: ${key}` };

  try {
    await setFlag(key, enabled, auth.user.id);
    updateTag(FEATURE_FLAGS_CACHE_TAG);
    revalidatePath('/admin/flags');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to toggle flag.' };
  }
}
