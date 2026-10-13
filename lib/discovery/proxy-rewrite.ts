/**
 * Address rewrites for the discovery surfaces, decided in proxy.ts. Pure, so
 * tests can pin them.
 *
 *   /<page>.md        -> /md/<page>          markdown twin (lib/discovery/markdown.ts)
 *   /<INDEXNOW_KEY>.txt -> /indexnow-key     the IndexNow key file
 *
 * Machine endpoints (/v1, /mcp, /llms*.txt, /openapi.json, /.well-known/mcp*)
 * carry no session, so the proxy skips the Supabase session refresh for them.
 */

export type DiscoveryRoute =
  | { kind: 'rewrite'; to: string }
  | { kind: 'machine' }
  | null;

const MACHINE = [/^\/v1(\/|$)/, /^\/mcp\/?$/, /^\/llms(-full)?\.txt$/, /^\/openapi\.json$/, /^\/\.well-known\/mcp(\.json|\/.*)?$/];

export function discoveryRoute(pathname: string, indexNowKey: string | undefined): DiscoveryRoute {
  const key = indexNowKey?.trim();
  if (key && /^[A-Za-z0-9-]{8,128}$/.test(key) && pathname === `/${key}.txt`) {
    return { kind: 'rewrite', to: '/indexnow-key' };
  }
  if (pathname.endsWith('.md') && pathname.length > 3 && !pathname.startsWith('/md/') && !pathname.startsWith('/api/') && !pathname.startsWith('/_next/')) {
    const page = pathname.slice(0, -3);
    return { kind: 'rewrite', to: `/md${page === '' ? '/' : page}` };
  }
  if (MACHINE.some((re) => re.test(pathname))) return { kind: 'machine' };
  return null;
}
