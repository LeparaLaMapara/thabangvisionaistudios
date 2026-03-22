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
          key: 'Content-Security-Policy-Report-Only',
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' https://res.cloudinary.com https://images.unsplash.com https://i.ytimg.com https://img.youtube.com data: blob:",
            "font-src 'self'",
            "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://api.paystack.co https://api.cloudinary.com",
            "frame-src https://checkout.paystack.com https://www.youtube.com https://player.vimeo.com",
            "frame-ancestors 'none'",
            "media-src 'self' https://res.cloudinary.com",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self' https://checkout.paystack.com",
          ].join('; '),
        },
      ],
    },
  ],
};

export default nextConfig;
