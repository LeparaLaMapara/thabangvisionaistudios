import { loadCatalog } from '@/lib/discovery/catalog';
import { toolJson } from '@/lib/discovery/api';
import { discoveryRateLimit, jsonResponse } from '@/lib/discovery/server';

/** GET /v1/tools: the free Ubunye apps. */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const limited = await discoveryRateLimit(request, 'api');
  if (limited) return limited;
  return jsonResponse({ items: (await loadCatalog()).tools.map(toolJson) });
}
