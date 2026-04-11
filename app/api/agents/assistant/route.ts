export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest } from 'next/server';
import { executeAgent } from '@/lib/agents/runtime';

export async function POST(req: NextRequest): Promise<Response> {
  return executeAgent('assistant', req);
}
