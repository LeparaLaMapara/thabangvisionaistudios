import { indexNowKey, isValidIndexNowKey } from '@/lib/discovery/notify';

/**
 * The IndexNow key file. Search engines fetch /<INDEXNOW_KEY>.txt to check
 * that pings really come from us; proxy.ts rewrites that address here
 * (lib/discovery/proxy-rewrite.ts). The key is public by design (it sits in
 * every ping), so this route needs no other guard. No valid key set: 404.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  const key = indexNowKey();
  if (!isValidIndexNowKey(key)) return new Response('Not found', { status: 404 });
  return new Response(key, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Robots-Tag': 'noindex' },
  });
}
