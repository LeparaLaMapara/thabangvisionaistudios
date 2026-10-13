import { openApiDocument } from '@/lib/discovery/openapi';
import { jsonResponse } from '@/lib/discovery/server';

/** OpenAPI 3.1 description of the /v1 catalogue API (lib/discovery/openapi.ts). */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return jsonResponse(openApiDocument());
}
