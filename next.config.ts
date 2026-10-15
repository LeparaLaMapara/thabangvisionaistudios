import type { NextConfig } from 'next';
import { FALLBACK_CSP } from './lib/security/csp';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  images: {
    loader: 'custom',
    loaderFile: './lib/cloudinary/loader.ts',
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'i.ytimg.com',
      },
      {
        protocol: 'https',
        hostname: 'img.youtube.com',
      },
    ],
  },
  // Cloudinary + Gemini secrets: no NEXT_PUBLIC_ prefix →
  // Next.js automatically excludes them from the client bundle.

  redirects: async () => [
    // Production slugs corrected in the database ("potraits" -> "portraits",
    // and a repeated word). The old URLs were live, so they keep working.
    {
      source: '/studio/professional-potraits',
      destination: '/studio/professional-portraits',
      permanent: true,
    },
    {
      source: '/studio/studio-maternity-potraits',
      destination: '/studio/studio-maternity-portraits',
      permanent: true,
    },
    {
      source: '/studio/birthday-family-birthday',
      destination: '/studio/family-birthday',
      permanent: true,
    },
    {
      source: '/smart-production',
      destination: '/studio',
      permanent: true,
    },
    {
      source: '/smart-production/:path*',
      destination: '/studio/:path*',
      permanent: true,
    },
    {
      source: '/smart-rentals',
      destination: '/rentals',
      permanent: true,
    },
    {
      source: '/smart-rentals/:path*',
      destination: '/rentals/:path*',
      permanent: true,
    },
    // The menu calls the free apps "Apps", so people type /apps. They live at /tools.
    {
      source: '/apps',
      destination: '/tools',
      permanent: true,
    },
    {
      source: '/apps/:path*',
      destination: '/tools/:path*',
      permanent: true,
    },
  ],

  // M2: Security headers
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        // The full Content-Security-Policy is set per request with a nonce in
        // proxy.ts (lib/security/csp.ts, security INJ-3): add new external
        // services there. This is only a FALLBACK for responses the proxy
        // does not see (static files, anything its matcher skips). Browsers
        // enforce every CSP header they get, so it must never restrict
        // scripts, styles, connections or images (no default-src/script-src):
        // it only adds directives that are the same in the main policy.
        { key: 'Content-Security-Policy', value: FALLBACK_CSP },
      ],
    },
  ],
};

export default nextConfig;
