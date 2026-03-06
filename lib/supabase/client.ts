import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser (client-side) Supabase client.
 * Call inside 'use client' components or browser event handlers.
 * Uses NEXT_PUBLIC_ keys — safe to expose.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
