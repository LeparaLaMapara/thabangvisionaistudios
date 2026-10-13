import { loadCatalog } from '@/lib/discovery/catalog';
import { creatorJson, findCreator } from '@/lib/discovery/api';
import { discoveryRateLimit, jsonResponse } from '@/lib/discovery/server';

/** GET /v1/creators/{handle}: one creator. */
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ handle: string }> }): Promise<Response> {
  const limited = await discoveryRateLimit(request, 'api');
  if (limited) return limited;
  const { handle } = await params;
  const creator = findCreator(await loadCatalog(), decodeURIComponent(handle));
  if (!creator) return jsonResponse({ error: 'No creator with that handle.' }, { status: 404 });
  return jsonResponse(creatorJson(creator));
}
