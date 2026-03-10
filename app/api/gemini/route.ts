export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, checkRateLimit } from '@/lib/auth';
import { ai } from '@/lib/ai';

/**
 * POST /api/gemini
 * AI chat proxy — the active provider's API key lives only on the server.
 * Requires authentication + rate limited to 10 requests/minute per user.
 *
 * Body:    { prompt: string; systemPrompt?: string; messages?: { role: 'user' | 'assistant'; content: string }[] }
 * Returns: { response: string }
 */
export async function POST(req: NextRequest) {
  // H1: Require authentication
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  // H1: Rate limit — 10 requests per minute per user
  const allowed = checkRateLimit(`ai:${auth.user.id}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before trying again.' },
      { status: 429 },
    );
  }

  if (!ai.isConfigured()) {
    return NextResponse.json(
      { error: 'AI provider is not configured on the server.' },
      { status: 500 },
    );
  }

  let prompt: string;
  let systemPrompt = 'You are a helpful creative studio assistant for Thabang Vision AI Studios, a platform for South African creators.';
  let messages: { role: 'user' | 'assistant'; content: string }[] | undefined;

  try {
    const body = await req.json();
    prompt = body.prompt;
    if (body.systemPrompt) systemPrompt = body.systemPrompt;
    if (body.messages) messages = body.messages;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return NextResponse.json(
      { error: '`prompt` is required and must be a non-empty string.' },
      { status: 400 },
    );
  }

  // Build message list: use provided history or just the single prompt
  const messageList = messages ?? [{ role: 'user' as const, content: prompt.trim() }];

  try {
    const result = await ai.sendMessage(systemPrompt, messageList);
    return NextResponse.json({ response: result.response });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[ai] ${ai.name} error:`, message);
    return NextResponse.json(
      { error: 'AI service temporarily unavailable.' },
      { status: 502 },
    );
  }
}
