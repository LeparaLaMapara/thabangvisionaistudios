import { isSitemapId, sitemapEntries, toUrlsetXml } from '@/lib/seo/sitemap';

/**
 * One child sitemap, /sitemap/<id>.xml (ids in lib/seo/sitemap-registry.ts).
 * Read fresh (the CDN keeps it an hour), unlike the old sitemap.ts, which
 * was written once at build time and went stale until the next deploy.
 */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: file } = await params;
  const id = file.replace(/\.xml$/, '');
  if (!file.endsWith('.xml') || !isSitemapId(id)) {
    return new Response('Not found', { status: 404 });
  }
  const entries = await sitemapEntries(id);
  return new Response(toUrlsetXml(entries), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // A dynamic route (the id is a path segment), so let the CDN hold it
      // for an hour instead of reading the database on every crawl.
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
