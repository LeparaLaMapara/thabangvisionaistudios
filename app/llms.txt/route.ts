import { loadCatalog } from '@/lib/discovery/catalog';
import { buildLlmsTxt } from '@/lib/discovery/llms';
import { textResponse } from '@/lib/discovery/server';
import { onlinePaymentsOpen } from '@/lib/payments/status';

/**
 * /llms.txt: what ThabangVision is and how to use it, for AI assistants.
 * Written from live data and constants (lib/discovery/llms.ts); the catalogue
 * is cached an hour and refreshed early by notifyDiscovery.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const catalog = await loadCatalog();
  return textResponse(buildLlmsTxt(catalog, { paymentsOpen: onlinePaymentsOpen() }), 'text/plain');
}
