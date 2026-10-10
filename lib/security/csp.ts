/**
 * The site's Content-Security-Policy, built per request with a fresh nonce
 * (Phase 6 security INJ-3).
 *
 * Before: script-src 'self' 'unsafe-inline', so any HTML injection (INJ-1)
 * ran as script with zero CSP violations. Now script-src allows only scripts
 * carrying this request's nonce, plus what they load ('strict-dynamic'):
 * Next.js reads the nonce from the request's Content-Security-Policy header
 * (set in proxy.ts) and puts it on its own inline and bundle scripts; Paystack
 * and Vercel scripts are injected by those trusted scripts. An injected
 * <script> has no nonce and is blocked.
 *
 * This works because every page is rendered per request (the build lists
 * every page route as dynamic, ƒ). A page that became static (prerendered)
 * would be served without nonces and its scripts would be blocked: keep
 * pages dynamic, or revisit this policy (docs/security/phase-6-assessment.md).
 *
 * style-src keeps 'unsafe-inline' (React style attributes, Framer Motion);
 * styles cannot run script.
 */

/**
 * Sent by next.config.ts on EVERY response, as a fallback for responses
 * proxy.ts does not see. Browsers enforce the intersection of all CSP
 * headers, so this holds only directives that the per-request policy also
 * has (identical values) and nothing that touches scripts, styles,
 * connections or images: it can never block a nonce'd script.
 */
export const FALLBACK_CSP = "object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

/** A fresh base64 nonce (128 bits). Works in the Node and Edge runtimes. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function buildCsp(nonce: string, opts: { dev?: boolean } = {}): string {
  const script = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // Ignored by browsers that support 'strict-dynamic'; kept for older ones.
    'https://js.paystack.co',
    'https://va.vercel-scripts.com',
    // React Refresh in `next dev` only.
    ...(opts.dev ? ["'unsafe-eval'"] : []),
  ];
  return [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https://res.cloudinary.com https://*.supabase.co https://images.unsplash.com https://i.ytimg.com https://img.youtube.com data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://api.paystack.co https://js.paystack.co https://api.cloudinary.com https://va.vercel-scripts.com https://vitals.vercel-insights.com https://nominatim.openstreetmap.org",
    "frame-src https://checkout.paystack.com https://www.youtube.com https://player.vimeo.com",
    "frame-ancestors 'none'",
    "media-src 'self' https://res.cloudinary.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.paystack.com",
    'upgrade-insecure-requests',
  ].join('; ');
}
