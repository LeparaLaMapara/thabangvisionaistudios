import { loadCatalog } from '@/lib/discovery/catalog';
import { handleMcpRequest } from '@/lib/discovery/mcp';
import { checkRentalAvailability, discoveryRateLimit, todaySast } from '@/lib/discovery/server';
import { onlinePaymentsOpen } from '@/lib/payments/status';

/**
 * The read-only ThabangVision MCP server (Streamable HTTP, stateless, JSON
 * responses). Tools and rules: lib/discovery/mcp.ts. No sign in, no writes.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const deps = {
  catalog: loadCatalog,
  availability: checkRentalAvailability,
  paymentsOpen: onlinePaymentsOpen,
  today: todaySast,
};

async function handle(request: Request): Promise<Response> {
  const limited = await discoveryRateLimit(request, 'mcp');
  if (limited) return limited;
  try {
    return await handleMcpRequest(request, deps);
  } catch (err) {
    console.error('[mcp]', err);
    return Response.json(
      { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
