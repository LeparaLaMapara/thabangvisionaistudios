import { loadCatalog } from '@/lib/discovery/catalog';
import { buildLlmsFullTxt } from '@/lib/discovery/llms';
import { textResponse } from '@/lib/discovery/server';
import { onlinePaymentsOpen } from '@/lib/payments/status';

/** /llms-full.txt: the whole public catalogue in markdown (lib/discovery/llms.ts). */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const catalog = await loadCatalog();
  return textResponse(buildLlmsFullTxt(catalog, { paymentsOpen: onlinePaymentsOpen() }), 'text/plain');
}
