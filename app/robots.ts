import type { MetadataRoute } from 'next';
import { STUDIO } from '@/lib/constants';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = STUDIO.meta.url;

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin/',
          '/dashboard/',
          '/api/',
          '/onboarding',
          '/reset-password',
          '/auth/',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
