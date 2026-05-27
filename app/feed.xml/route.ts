import { STUDIO } from '@/lib/constants';
import { getPublishedPress } from '@/lib/supabase/queries/press';

export const revalidate = 3600;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET() {
  const baseUrl = STUDIO.meta.url;
  const articles = await getPublishedPress();

  const items = articles
    .map((a) => {
      const pubDate = a.published_at
        ? new Date(a.published_at).toUTCString()
        : new Date(a.created_at).toUTCString();

      return `    <item>
      <title>${escapeXml(a.title)}</title>
      <link>${baseUrl}/press/${encodeURIComponent(a.slug)}</link>
      <guid isPermaLink="true">${baseUrl}/press/${encodeURIComponent(a.slug)}</guid>
      <pubDate>${pubDate}</pubDate>
      ${a.excerpt ? `<description>${escapeXml(a.excerpt)}</description>` : ''}
      ${a.author ? `<dc:creator>${escapeXml(a.author)}</dc:creator>` : ''}
      ${a.category ? `<category>${escapeXml(a.category)}</category>` : ''}
      ${a.cover_url ? `<enclosure url="${escapeXml(a.cover_url)}" type="image/jpeg" length="0" />` : ''}
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(STUDIO.name)} — Press</title>
    <link>${baseUrl}/press</link>
    <description>${escapeXml(STUDIO.meta.description)}</description>
    <language>en-za</language>
    <atom:link href="${baseUrl}/feed.xml" rel="self" type="application/rss+xml" />
    <image>
      <url>${baseUrl}/logo-black-bg.png</url>
      <title>${escapeXml(STUDIO.name)}</title>
      <link>${baseUrl}</link>
    </image>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
