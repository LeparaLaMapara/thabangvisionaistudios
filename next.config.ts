import type { NextConfig } from 'next';

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
  ],

  // M2: Security headers
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        // Content-Security-Policy is set per request with a nonce in proxy.ts
        // (lib/security/csp.ts, security INJ-3). When adding a new external
        // service, update the directives there.
      ],
    },
  ],
};

export default nextConfig;
