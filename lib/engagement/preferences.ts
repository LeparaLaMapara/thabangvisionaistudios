import { createAdminClient } from '@/lib/supabase/server';

/**
 * Sets or clears a person's opt-out from lifecycle emails (087). Server only:
 * the column is not client-writable (067 column grants).
 */
export async function setLifecycleOptOut(userId: string, optOut: boolean): Promise<void> {
  const { error } = await createAdminClient()
    .from('profiles')
    .update({ email_lifecycle_opt_out: optOut, email_lifecycle_opt_out_at: optOut ? new Date().toISOString() : null })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}
