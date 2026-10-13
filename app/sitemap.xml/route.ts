import { toIndexXml } from '@/lib/seo/sitemap';

/**
 * The sitemap index at /sitemap.xml, the address robots.txt gives. It lists
 * the child sitemaps at /sitemap/<id>.xml (app/sitemap/[id]/route.ts). No
 * <lastmod> per child: each child carries real dates on its own entries.
 */
export const revalidate = 3600;

export function GET(): Response {
  return new Response(toIndexXml(), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
