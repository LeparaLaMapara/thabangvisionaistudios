import { loadCatalog } from '@/lib/discovery/catalog';
import { searchCreators } from '@/lib/discovery/api';
import { discoveryRateLimit, jsonResponse } from '@/lib/discovery/server';

/** GET /v1/creators: search creators open for bookings. */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const limited = await discoveryRateLimit(request, 'api');
  if (limited) return limited;
  const p = new URL(request.url).searchParams;
  const result = searchCreators(await loadCatalog(), {
    query: p.get('q'),
    category: p.get('category'),
    city: p.get('city'),
    limit: Number(p.get('limit') ?? '') || undefined,
    offset: Number(p.get('offset') ?? '') || 0,
  });
  return jsonResponse(result);
}
