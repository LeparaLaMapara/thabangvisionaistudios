import type { MetadataRoute } from 'next';
import { STUDIO } from '@/lib/constants';
import {
  PRIVATE_PATHS,
  PUBLIC_API_PATHS,
  DISCOVERY_PATHS,
  ALLOWED_AI_CRAWLERS,
  BLOCKED_CRAWLERS,
} from '@/lib/seo/crawlers';

/** robots.txt. Who is allowed and why: lib/seo/crawlers.ts. */

export default function robots(): MetadataRoute.Robots {
  const baseUrl = STUDIO.meta.url;
  const rules = {
    allow: ['/', ...PUBLIC_API_PATHS, ...DISCOVERY_PATHS],
    disallow: [...PRIVATE_PATHS],
  };

  return {
    rules: [
      { userAgent: '*', ...rules },
      { userAgent: [...ALLOWED_AI_CRAWLERS], ...rules },
      { userAgent: [...BLOCKED_CRAWLERS], disallow: '/' },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
