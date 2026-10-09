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

  // M1: CSRF protection — validate Origin header on mutation requests to /api/ routes
  // Exemptions: PayFast ITN webhook (server-to-server, no Origin header)
  const method = request.method;
  const isApiMutation =
    request.nextUrl.pathname.startsWith('/api/') &&
    ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
  const isWebhook = request.nextUrl.pathname.startsWith('/api/webhooks/');

  if (isApiMutation && !isWebhook) {
    const origin = request.headers.get('origin');
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const parsedUrl = new URL(appUrl);
    const allowedOrigins = new Set<string>([parsedUrl.origin]);

    // Allow both www and non-www variants of the same domain
    if (parsedUrl.hostname.startsWith('www.')) {
      allowedOrigins.add(`${parsedUrl.protocol}//${parsedUrl.hostname.slice(4)}`);
    } else if (!['localhost', '127.0.0.1'].includes(parsedUrl.hostname)) {
      allowedOrigins.add(`${parsedUrl.protocol}//www.${parsedUrl.hostname}`);
    }

    // Allow Vercel preview deployments
    const isVercelPreview = origin?.endsWith('.vercel.app') && origin.includes('thabangvision');

    if (origin && !allowedOrigins.has(origin) && !isVercelPreview) {
      return NextResponse.json(
        { error: 'Invalid origin.' },
        { status: 403 },
      );
    }
  }

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
    return redirect;
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all paths EXCEPT:
     * - _next/static  (Next.js internals)
     * - _next/image   (image optimisation files)
     * - favicon.ico
     * - Public static files (svg, png, jpg, etc.)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
