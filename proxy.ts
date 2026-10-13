import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import {
  decideMaintenance,
  maintenancePageHtml,
  MAINTENANCE_BYPASS_COOKIE,
  MAINTENANCE_PAGE_CSP,
  MAINTENANCE_PREVIEW_PARAM,
  MAINTENANCE_RETRY_AFTER_SECONDS,
} from '@/lib/maintenance';
import { buildCsp, generateNonce } from '@/lib/security/csp';
import { discoveryRoute } from '@/lib/discovery/proxy-rewrite';

/** Applies maintenance mode (lib/maintenance.ts). Returns null to continue normally. */
function maintenanceResponse(request: NextRequest): NextResponse | null {
  const decision = decideMaintenance({
    pathname: request.nextUrl.pathname,
    previewParam: request.nextUrl.searchParams.get(MAINTENANCE_PREVIEW_PARAM),
    bypassCookie: request.cookies.get(MAINTENANCE_BYPASS_COOKIE)?.value,
    maintenanceMode: process.env.MAINTENANCE_MODE,
    bypassToken: process.env.MAINTENANCE_BYPASS_TOKEN,
  });

  switch (decision.action) {
    case 'pass':
      return null;
    case 'set-bypass':
    case 'clear-bypass': {
      const clean = request.nextUrl.clone();
      clean.searchParams.delete(MAINTENANCE_PREVIEW_PARAM);
      const res = NextResponse.redirect(clean);
      if (decision.action === 'set-bypass') {
        res.cookies.set(MAINTENANCE_BYPASS_COOKIE, decision.token, {
          httpOnly: true,
          secure: request.nextUrl.protocol === 'https:',
          sameSite: 'lax',
          path: '/',
          maxAge: 60 * 60 * 24 * 7,
        });
      } else {
        res.cookies.delete(MAINTENANCE_BYPASS_COOKIE);
      }
      return res;
    }
    case 'api':
      return NextResponse.json(
        { error: 'The service is temporarily unavailable for maintenance.' },
        {
          status: 503,
          headers: {
            'Retry-After': String(MAINTENANCE_RETRY_AFTER_SECONDS),
            'Cache-Control': 'no-store',
          },
        },
      );
    case 'page':
      return new NextResponse(maintenancePageHtml(), {
        status: 503,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Retry-After': String(MAINTENANCE_RETRY_AFTER_SECONDS),
          'Cache-Control': 'no-store',
          'Content-Security-Policy': MAINTENANCE_PAGE_CSP,
          'X-Robots-Tag': 'noindex',
        },
      });
  }
}

// ─── CSRF ────────────────────────────────────────────────────────────────────

/** Supabase auth cookie (sb-<ref>-auth-token, possibly chunked .0/.1). */
const SESSION_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

export interface OriginEnv {
  NEXT_PUBLIC_APP_URL?: string;
  VERCEL_URL?: string;
  VERCEL_BRANCH_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
}

/**
 * Origins the app is served from (exported for tests):
 *   - NEXT_PUBLIC_APP_URL, plus its www/apex twin (production is served on
 *     www, and the apex redirects there; a preview's NEXT_PUBLIC_APP_URL, e.g.
 *     the nonprod alias, is accepted the same way);
 *   - this deployment's own hosts, set by Vercel at runtime: VERCEL_URL (the
 *     per-deployment URL), VERCEL_BRANCH_URL (the git branch alias, e.g. the
 *     develop preview) and VERCEL_PROJECT_PRODUCTION_URL.
 * Before, any *.vercel.app origin containing "thabangvision" was trusted,
 * which anyone can register.
 */
export function allowedOrigins(env: OriginEnv = {
  // Literal process.env reads, so Next.js still inlines NEXT_PUBLIC_APP_URL.
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  VERCEL_URL: process.env.VERCEL_URL,
  VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL,
  VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
}): Set<string> {
  const parsedUrl = new URL(env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3000');
  const allowed = new Set<string>([parsedUrl.origin]);
  if (parsedUrl.hostname.startsWith('www.')) {
    allowed.add(`${parsedUrl.protocol}//${parsedUrl.hostname.slice(4)}${parsedUrl.port ? `:${parsedUrl.port}` : ''}`);
  } else if (!['localhost', '127.0.0.1'].includes(parsedUrl.hostname)) {
    allowed.add(`${parsedUrl.protocol}//www.${parsedUrl.hostname}${parsedUrl.port ? `:${parsedUrl.port}` : ''}`);
  }
  for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (host) allowed.add(`https://${host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`);
  }
  return allowed;
}

function originOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Refuses a cross-site state-changing API request. Webhooks and cron are
 * server-to-server (signed / bearer secret) and exempt.
 *   - An Origin header (including "null") must be one of ours.
 *   - With NO Origin header, a request that carries a Supabase session cookie
 *     must have a Referer from one of our origins (security AUTH-4: the
 *     check used to be skipped whenever Origin was absent). A request with
 *     neither Origin nor a session cookie cannot act as anyone, so it passes.
 * Exported for tests.
 */
export function csrfRejection(request: NextRequest): NextResponse | null {
  const path = request.nextUrl.pathname;
  const isApiMutation = path.startsWith('/api/') && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method);
  const isExempt = path.startsWith('/api/webhooks/') || path.startsWith('/api/cron/');
  if (!isApiMutation || isExempt) return null;

  const allowed = allowedOrigins();
  const origin = request.headers.get('origin');
  const refuse = () => NextResponse.json({ error: 'Invalid origin.' }, { status: 403 });

  if (origin !== null) return allowed.has(origin) ? null : refuse();

  const hasSession = request.cookies.getAll().some((c) => SESSION_COOKIE.test(c.name));
  if (!hasSession) return null;
  const refererOrigin = originOf(request.headers.get('referer'));
  return refererOrigin && allowed.has(refererOrigin) ? null : refuse();
}

/**
 * Runs on every request matching the pattern below.
 * Silently refreshes the Supabase session token so Server Components
 * and the (admin) layout always receive a fresh, valid session.
 *
 * IMPORTANT: Do not remove the getUser() call — it is what triggers
 * the token refresh.
 */
export async function proxy(request: NextRequest) {
  // Maintenance mode runs first: it must not depend on Supabase being reachable.
  const maintenance = maintenanceResponse(request);
  if (maintenance) return maintenance;

  // M1 / security AUTH-4: CSRF protection for state-changing /api requests.
  const csrf = csrfRejection(request);
  if (csrf) return csrf;

  // Discovery surfaces (lib/discovery/proxy-rewrite.ts): markdown twins at
  // <page>.md and the IndexNow key file are rewritten to their handlers; the
  // machine endpoints (/v1, /mcp, llms.txt...) carry no session, so they skip
  // the session refresh below.
  const discovery = discoveryRoute(request.nextUrl.pathname, process.env.INDEXNOW_KEY);
  if (discovery?.kind === 'rewrite') {
    const target = request.nextUrl.clone();
    target.pathname = discovery.to;
    return NextResponse.rewrite(target);
  }
  if (discovery?.kind === 'machine') return NextResponse.next();

  // Content-Security-Policy with a per-request nonce (security INJ-3). On
  // the REQUEST so Next.js puts the nonce on its scripts, and on every
  // response returned below.
  const nonce = generateNonce();
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV === 'development' });
  request.headers.set('x-nonce', nonce);
  request.headers.set('Content-Security-Policy', csp);
  const withCsp = <T extends NextResponse>(res: T): T => {
    res.headers.set('Content-Security-Policy', csp);
    return res;
  };

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Must set on both request and response for the session to propagate
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh session — do NOT remove this line
  const { data: { user } } = await supabase.auth.getUser();

  // Signed-out visitors to the dashboard go to sign-in with the page they
  // wanted as ?next= (the dashboard layout cannot see its own path, so this
  // is the server-side redirect; the layout keeps a browser fallback).
  const path = request.nextUrl.pathname;
  if (!user && (path === '/dashboard' || path.startsWith('/dashboard/'))) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.search = '';
    login.searchParams.set('next', `${path}${request.nextUrl.search}`);
    const redirect = NextResponse.redirect(login);
    supabaseResponse.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return withCsp(redirect);
  }

  return withCsp(supabaseResponse);
}

export const config = {
  matcher: [
    /*
     * Match all paths EXCEPT:
     * - _next/static  (Next.js internals)
     * - _next/image   (image optimisation files)
     * - the real files in public/ (favicon.ico, logo-*.png|webp at the root,
     *   the Google site-verification file).
     * Before, ANY path ending in .png/.svg/.jpg... skipped the proxy, so e.g.
     * /studio/x.png rendered the dynamic 404 with no per-request CSP
     * (security review). Add a pattern here when a new file goes in public/.
     */
    '/((?!_next/static|_next/image|favicon\\.ico$|logo-[A-Za-z0-9-]+\\.(?:png|webp)$|google[0-9a-f]+\\.html$).*)',
  ],
};
