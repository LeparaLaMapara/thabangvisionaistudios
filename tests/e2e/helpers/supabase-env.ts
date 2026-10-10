/**
 * CI-style builds (and the local "ci-env" build) point the app at a dummy
 * Supabase project, https://example.supabase.co, because no real project is
 * available there. Against that host:
 *   - password sign-in can never succeed or fail with Supabase's own
 *     "Invalid login credentials" (the Auth call cannot reach a server);
 *   - every server render waits several seconds on the unreachable host, so a
 *     test that loads many pages in one go exceeds its timeout.
 * Tests that need a reachable Supabase skip themselves in that case. Run them
 * against a real (local) Supabase, e.g. the tests/e2e-local harness env.
 *
 * The check reads NEXT_PUBLIC_SUPABASE_URL from the Playwright process, so
 * export the same env the app was built with before running the suite.
 */
export const DUMMY_SUPABASE_HOST = 'example.supabase.co';

export function usesDummySupabase(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  try {
    return new URL(url).hostname === DUMMY_SUPABASE_HOST;
  } catch {
    return false;
  }
}

export const DUMMY_SUPABASE_SKIP_REASON =
  `NEXT_PUBLIC_SUPABASE_URL is the dummy ${DUMMY_SUPABASE_HOST}: needs a reachable Supabase (environment-only, not an app failure)`;
