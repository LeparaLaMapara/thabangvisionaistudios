export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest } from 'next/server';
import { executeAgent } from '@/lib/agents/runtime';

// Backward compatibility — delegates to assistant agent.
// The frontend still calls /api/ubunye-chat; this route now proxies
// through the shared agent runtime so behaviour is identical.
export async function POST(req: NextRequest): Promise<Response> {
  return executeAgent('assistant', req);
}
