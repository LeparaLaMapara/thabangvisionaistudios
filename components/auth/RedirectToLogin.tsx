'use client';

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { loginUrl } from '@/lib/auth/next-path';

/**
 * Sends a signed-out visitor to /login with the page they asked for as
 * `?next=`, so they come straight back after signing in. A server layout
 * cannot see its own path, so this runs in the browser; the link is there
 * for the moment before it does.
 */
export function RedirectToLogin() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const target = useMemo(() => {
    const query = searchParams.toString();
    return loginUrl(query ? `${pathname}?${query}` : pathname);
  }, [pathname, searchParams]);

  useEffect(() => {
    window.location.replace(target);
  }, [target]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-40 px-4 text-center">
      <p className="text-xs font-mono text-neutral-400">Please sign in to continue.</p>
      <Link
        href={target}
        className="inline-flex items-center min-h-[44px] px-6 text-xs font-mono uppercase tracking-widest text-white underline underline-offset-2"
      >
        Sign in
      </Link>
    </div>
  );
}
