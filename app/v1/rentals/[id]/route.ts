import { loadCatalog } from '@/lib/discovery/catalog';
import { findRental, rentalJson } from '@/lib/discovery/api';
import { discoveryRateLimit, jsonResponse } from '@/lib/discovery/server';

/** GET /v1/rentals/{id}: one item of gear by id or slug. */
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const limited = await discoveryRateLimit(request, 'api');
  if (limited) return limited;
  const { id } = await params;
  const rental = findRental(await loadCatalog(), decodeURIComponent(id));
  if (!rental) return jsonResponse({ error: 'No gear with that id or slug.' }, { status: 404 });
  return jsonResponse(rentalJson(rental));
}
