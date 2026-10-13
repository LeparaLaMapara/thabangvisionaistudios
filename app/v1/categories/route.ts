import { loadCatalog } from '@/lib/discovery/catalog';
import { categoriesJson } from '@/lib/discovery/api';
import { discoveryRateLimit, jsonResponse } from '@/lib/discovery/server';

/** GET /v1/categories: gear categories with stock, and studio categories. */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const limited = await discoveryRateLimit(request, 'api');
  if (limited) return limited;
  return jsonResponse(categoriesJson(await loadCatalog()));
}
