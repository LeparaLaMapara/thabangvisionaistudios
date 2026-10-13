import { STUDIO, SITE_COPYRIGHT } from '@/lib/constants';

/**
 * Site-wide maintenance mode.
 *
 * Turned on by setting MAINTENANCE_MODE=true in the deployment's env vars
 * (Vercel → Settings → Environment Variables, then redeploy). While on,
 * every page shows a self-contained "under maintenance" page and every API
 * route returns 503 — except the paths below, which must keep working:
 *
 *   - /api/webhooks/*  payment providers still confirm in-flight payments
 *   - /api/cron/*      scheduled jobs (expired holds, reminders) keep running
 *
 * The owner can still browse the real site to test it: visiting any URL with
 * ?preview=<MAINTENANCE_BYPASS_TOKEN> sets a cookie that skips maintenance
 * for that browser. Visiting with ?preview=off clears it.
 *
 * Night opening: while MAINTENANCE_OPEN_NIGHTS_UNTIL holds a date in the
 * future (e.g. 2026-10-19T05:00:00+02:00), the real site is open every night
 * from 00:00 to 05:00 South African time, so search engines can crawl it
 * before the relaunch. After that date the setting does nothing.
 *
 * The page is plain HTML built here, not a React route, on purpose: the root
 * layout queries Supabase, and maintenance often means the database itself
 * is being worked on.
 */

export const MAINTENANCE_BYPASS_COOKIE = 'tv_maintenance_bypass';
export const MAINTENANCE_PREVIEW_PARAM = 'preview';

/** Paths that stay live while maintenance mode is on. */
const ALWAYS_ALLOWED_PREFIXES = ['/api/webhooks/', '/api/cron/'] as const;

/** Files crawlers and browsers fetch that must not be swapped for HTML. */
const ALWAYS_ALLOWED_EXACT = ['/robots.txt', '/manifest.webmanifest'] as const;

export type MaintenanceDecision =
  | { action: 'pass' }
  | { action: 'set-bypass'; token: string }
  | { action: 'clear-bypass' }
  | { action: 'page' }
  | { action: 'api' };

export interface MaintenanceInput {
  pathname: string;
  previewParam: string | null;
  bypassCookie: string | undefined;
  maintenanceMode: string | undefined;
  bypassToken: string | undefined;
  /** MAINTENANCE_OPEN_NIGHTS_UNTIL: last moment of the nightly opening. */
  openNightsUntil?: string | undefined;
  now?: Date;
}

/** Nightly opening hours, South African time (UTC+2, no daylight saving). */
const NIGHT_OPEN_FROM_HOUR = 0;
const NIGHT_OPEN_TO_HOUR = 5;
const SAST_OFFSET_HOURS = 2;

/** True when the site should be open because it is night time before the cut-off. */
export function isNightOpen(openNightsUntil: string | undefined, now: Date): boolean {
  if (!openNightsUntil?.trim()) return false;
  const until = Date.parse(openNightsUntil.trim());
  if (Number.isNaN(until) || now.getTime() >= until) return false;
  const hour = (now.getUTCHours() + SAST_OFFSET_HOURS) % 24;
  return hour >= NIGHT_OPEN_FROM_HOUR && hour < NIGHT_OPEN_TO_HOUR;
}

export function isMaintenanceOn(flag: string | undefined): boolean {
  return flag?.trim().toLowerCase() === 'true';
}

/** Constant-time comparison so the bypass token can't be guessed by timing. */
function tokensMatch(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** Decide what the proxy should do with a request. Pure, so it is unit-tested. */
export function decideMaintenance(input: MaintenanceInput): MaintenanceDecision {
  if (!isMaintenanceOn(input.maintenanceMode)) return { action: 'pass' };
  if (isNightOpen(input.openNightsUntil, input.now ?? new Date())) return { action: 'pass' };

  const { pathname } = input;
  if (ALWAYS_ALLOWED_PREFIXES.some((p) => pathname.startsWith(p))) return { action: 'pass' };
  if ((ALWAYS_ALLOWED_EXACT as readonly string[]).includes(pathname)) return { action: 'pass' };

  // A bypass needs a token of real length; an unset or short token disables it.
  const token = input.bypassToken?.trim() ?? '';
  const bypassEnabled = token.length >= 16;

  if (input.previewParam === 'off') return { action: 'clear-bypass' };
  if (bypassEnabled && input.previewParam && tokensMatch(input.previewParam, token)) {
    return { action: 'set-bypass', token };
  }
  if (bypassEnabled && input.bypassCookie && tokensMatch(input.bypassCookie, token)) {
    return { action: 'pass' };
  }

  return pathname.startsWith('/api/') ? { action: 'api' } : { action: 'page' };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** How long crawlers and clients are told to wait before retrying (seconds). */
export const MAINTENANCE_RETRY_AFTER_SECONDS = 3600;

export const MAINTENANCE_PAGE_CSP =
  "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function maintenancePageHtml(): string {
  const name = escapeHtml(STUDIO.shortName);
  const email = escapeHtml(STUDIO.email);
  const copyright = escapeHtml(SITE_COPYRIGHT);

  return `<!doctype html>
<html lang="en-ZA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${name} | Under maintenance</title>
<link rel="icon" href="/favicon.ico">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{background:#050505;color:#e5e5e5;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 16px;text-align:center}
  main{max-width:560px;width:100%}
  img{width:96px;height:auto;margin:0 auto 32px;display:block}
  .label{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#D4A843;margin-bottom:16px}
  h1{font-size:clamp(28px,6vw,44px);line-height:1.15;font-weight:700;color:#fafafa;margin-bottom:16px}
  p{font-size:16px;line-height:1.6;color:#a3a3a3;margin-bottom:12px}
  a{color:#D4A843;text-decoration:underline;text-underline-offset:3px;display:inline-block;min-height:44px;line-height:44px}
  .rule{width:48px;height:2px;background:#D4A843;margin:28px auto}
  footer{margin-top:48px;font-size:12px;color:#737373;max-width:560px}
</style>
</head>
<body>
<main>
  <img src="/logo-transparent.png" alt="${name}">
  <div class="label">Scheduled maintenance</div>
  <h1>We're improving ${name}</h1>
  <p>The site is temporarily offline while we upgrade and test the platform. We'll be back soon.</p>
  <div class="rule"></div>
  <p>Have a booking with us, or need help in the meantime? Email us and we'll respond.</p>
  <a href="mailto:${email}">${email}</a>
</main>
<footer>${copyright}</footer>
</body>
</html>`;
}
