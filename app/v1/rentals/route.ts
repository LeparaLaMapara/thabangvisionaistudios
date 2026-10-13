import { loadCatalog } from '@/lib/discovery/catalog';
import { parseDates, searchRentals } from '@/lib/discovery/api';
import { checkRentalAvailability, discoveryRateLimit, jsonResponse, todaySast } from '@/lib/discovery/server';

/** GET /v1/rentals: search gear for hire (described in /openapi.json). */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const limited = await discoveryRateLimit(request, 'api');
  if (limited) return limited;
  try {
    const p = new URL(request.url).searchParams;
    const dates = parseDates(p.get('start'), p.get('end'), todaySast());
    if (dates && 'error' in dates) return jsonResponse({ error: dates.error }, { status: 400, cache: false });
    const catalog = await loadCatalog();
    const result = await searchRentals(
      catalog,
      {
        query: p.get('q'),
        category: p.get('category'),
        city: p.get('city'),
        dates,
        limit: Number(p.get('limit') ?? '') || undefined,
        offset: Number(p.get('offset') ?? '') || 0,
      },
      checkRentalAvailability,
    );
    return jsonResponse(result, { cache: !dates });
  } catch (err) {
    console.error('[v1/rentals]', err);
    return jsonResponse({ error: 'Could not read the catalogue. Try again.' }, { status: 500, cache: false });
  }
}
