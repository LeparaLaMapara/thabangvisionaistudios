export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/gemini
 * Secure proxy — GEMINI_API_KEY lives only on the server.
 * Client code calls this route; the key is never bundled to the browser.
 *
 * Body:    { prompt: string; model?: string }
 * Returns: raw Gemini generateContent JSON
 */
export async function POST(req: NextRequest) {
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

  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        contents: [{ parts: [{ text: prompt.trim() }] }],
      }),
    },
  );

  if (!upstream.ok) {
    const detail = await upstream.text();
    return NextResponse.json(
      { error: 'Gemini upstream error.', detail },
      { status: upstream.status },
    );
  }

  const data = await upstream.json();
  return NextResponse.json(data);
}
