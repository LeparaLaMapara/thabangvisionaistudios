import { loadCatalog } from '@/lib/discovery/catalog';
import { renderMarkdownTwin } from '@/lib/discovery/markdown';
import { absUrl } from '@/lib/discovery/format';
import { textResponse } from '@/lib/discovery/server';
import { onlinePaymentsOpen } from '@/lib/payments/status';

/**
 * Markdown twins. Visitors ask for <page>.md; proxy.ts rewrites that here
 * (lib/discovery/proxy-rewrite.ts). The Link header names the HTML page as
 * canonical so search engines index the page, not the twin.
 */
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await params;
  const pagePath = `/${path.map((p) => encodeURIComponent(decodeURIComponent(p))).join('/')}`;
  const catalog = await loadCatalog();
  const md = renderMarkdownTwin(pagePath, catalog, { paymentsOpen: onlinePaymentsOpen() });
  if (md === null) {
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex' } });
  }
  return textResponse(md, 'text/markdown', { Link: `<${absUrl(pagePath)}>; rel="canonical"` });
}
