import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server-side Supabase client.
 * Call inside Server Components, Server Actions, and Route Handlers.
 * Never import this in 'use client' files.
 */
export async function createClient() {
  // In Next.js 16, cookies() is async
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Thrown when called from a Server Component (read-only context).
            // The middleware handles session refresh, so this is safe to ignore.
          }
        },
      },
    },
  );
}
