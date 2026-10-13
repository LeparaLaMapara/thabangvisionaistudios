import { mcpServerCard } from '@/lib/discovery/mcp';
import { jsonResponse } from '@/lib/discovery/server';

/** Discovery card for the MCP server at /mcp (lib/discovery/mcp.ts). */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return jsonResponse(mcpServerCard());
}
