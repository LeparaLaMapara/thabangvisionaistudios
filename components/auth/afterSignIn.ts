'use client';

import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { homeFor } from '@/lib/welcome';
import {
  afterSignInPath,
  cleanNextPath,
  consentStateFromResponse,
  type ConsentState,
} from '@/lib/auth/next-path';

/** Ask the server whether the signed-in person still has to accept the Terms and Privacy Policy. */
async function fetchConsentState(): Promise<ConsentState> {
  try {
    const res = await fetch('/api/consent?context=onboarding', { cache: 'no-store' });
    const body: unknown = await res.json().catch(() => null);
    return consentStateFromResponse(res.status, body);
  } catch {
    return 'unknown';
  }
}

/**
 * Where to go with no destination on the URL: the same answer the auth
 * callback gives (what they said they came to do, or /welcome to ask).
 */
async function homeForUser(user: User): Promise<string> {
  try {
    const supabase = createClient();
    const { data } = await supabase
      .from('profiles')
      .select('onboarding_completed_at')
      .eq('id', user.id)
      .maybeSingle();
    return homeFor(user.user_metadata?.intent, !!data?.onboarding_completed_at);
  } catch {
    return homeFor(user.user_metadata?.intent, false);
  }
}

/**
 * Admins are marked on their profile (profiles.role). This only picks where to
 * go: /admin itself checks again on the server and refuses anyone else.
 */
async function hasAdminRole(user: User): Promise<boolean> {
  try {
    const { data } = await createClient().from('profiles').select('role').eq('id', user.id).maybeSingle();
    return data?.role === 'admin';
  } catch {
    return false;
  }
}

/**
 * Finish a sign-in that happened in the browser (email + password, or Google's
 * own button; the Google redirect and the confirmation link finish in
 * app/auth/callback): send the person
 * to /welcome first if their acceptance of the current terms is not on
 * record, otherwise straight on.
 */
export async function destinationAfterSignIn(user: User, next: string): Promise<string> {
  const isAdmin = user.app_metadata?.role === 'admin' || (await hasAdminRole(user));
  if (isAdmin) return afterSignInPath({ isAdmin, consent: 'ok', next });
  const explicit = cleanNextPath(next);
  const [consent, fallback] = await Promise.all([
    fetchConsentState(),
    explicit ? Promise.resolve(explicit) : homeForUser(user),
  ]);
  return afterSignInPath({ isAdmin, consent, next: explicit, fallback });
}
