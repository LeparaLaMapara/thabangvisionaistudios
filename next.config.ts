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
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://js.paystack.co https://va.vercel-scripts.com",
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
            "upgrade-insecure-requests",
          ].join('; '),
        },
      ],
    },
  ],
};

export default nextConfig;
