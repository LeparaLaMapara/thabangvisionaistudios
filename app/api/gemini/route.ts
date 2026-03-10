export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, checkRateLimit } from '@/lib/auth';

const ALLOWED_MODELS = ['gemini-pro', 'gemini-pro-vision', 'gemini-1.5-pro', 'gemini-1.5-flash'];

/**
 * POST /api/gemini
 * Secure proxy — GEMINI_API_KEY lives only on the server.
 * Requires authentication + rate limited to 10 requests/minute per user.
 *
 * Body:    { prompt: string; model?: string }
 * Returns: raw Gemini generateContent JSON
 */
export async function POST(req: NextRequest) {
  // H1: Require authentication
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  // H1: Rate limit — 10 requests per minute per user
  const allowed = checkRateLimit(`gemini:${auth.user.id}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before trying again.' },
      { status: 429 },
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY is not configured on the server.' },
      { status: 500 },
    );
  }

  let prompt: string;
  let model = 'gemini-pro';

  try {
    const body = await req.json();
    prompt = body.prompt;
    if (body.model) model = body.model;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return NextResponse.json(
      { error: '`prompt` is required and must be a non-empty string.' },
      { status: 400 },
    );
  }

  // H1: Validate model against allowlist to prevent URL manipulation
  if (!ALLOWED_MODELS.includes(model)) {
    return NextResponse.json(
      { error: `Invalid model. Allowed: ${ALLOWED_MODELS.join(', ')}` },
      { status: 400 },
    );
  }

  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt.trim() }] }],
      }),
    },
  );

  if (!upstream.ok) {
    const detail = await upstream.text();
    console.error('[gemini] Upstream error:', detail);
    return NextResponse.json(
      { error: 'AI service temporarily unavailable.' },
      { status: 502 },
    );
  }

  const data = await upstream.json();
  return NextResponse.json(data);
}
