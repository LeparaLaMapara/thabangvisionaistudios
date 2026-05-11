export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { routeQuery } from '@/lib/ai';
import { createAdminClient } from '@/lib/supabase/server';
import { buildSystemPrompt, fetchPlatformData } from '@/lib/ubunye/system-prompt';
import { whatsapp } from '@/lib/whatsapp';
import { logEvent } from '@/lib/data/events';

// ─── Conversation Memory (in-memory, per phone number, 10 messages) ────────

type ConversationEntry = { role: 'user' | 'assistant'; content: string };
const conversations = new Map<string, ConversationEntry[]>();
const MAX_HISTORY = 10;

function getHistory(phone: string): ConversationEntry[] {
  return conversations.get(phone) ?? [];
}

function addToHistory(phone: string, role: 'user' | 'assistant', content: string): void {
  const history = getHistory(phone);
  history.push({ role, content });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  conversations.set(phone, history);
}

// ─── POST handler (receives webhook from Twilio) ───────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!whatsapp.isConfigured()) {
    return new NextResponse('WhatsApp not configured', { status: 503 });
  }

  // Parse form-encoded body and verify Twilio signature
  const rawBody = await request.text();
  const params: Record<string, string> = {};
  new URLSearchParams(rawBody).forEach((value, key) => { params[key] = String(value); });

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => { headers[key] = value; });

  if (!whatsapp.validateWebhook(headers, rawBody)) {
    return new NextResponse('Invalid signature', { status: 401 });
  }

  const message = whatsapp.parseIncoming(params);
  if (!message) {
    return new NextResponse('Invalid message', { status: 400 });
  }

  logEvent({
    eventType: 'whatsapp_message_received',
    eventCategory: 'whatsapp',
    metadata: { from: message.from, profileName: message.profileName },
  });

  try {
    // Build system prompt with platform data
    const supabase = createAdminClient();
    const { getFlags } = await import('@/lib/features');
    const flagsState = await getFlags(['smart_productions']);
    const flags = { smart_productions: flagsState.smart_productions };
    const platformData = await fetchPlatformData(supabase, flags);
    let systemPrompt = buildSystemPrompt(platformData, null, flags);
    systemPrompt += '\n\nYou are responding via WhatsApp. Keep responses concise (under 1000 characters). Use plain text, no markdown. Be warm and helpful. The user\'s name is ' + (message.profileName || 'there') + '.';

    // Build message history
    addToHistory(message.from, 'user', message.body);
    const history = getHistory(message.from);

    // Route to appropriate model
    const { model, tier } = routeQuery(message.body);

    const result = await generateText({
      model,
      system: systemPrompt,
      messages: history.map(m => ({ role: m.role, content: m.content })),
      maxOutputTokens: 500,
    });

    const responseText = result.text || 'Sorry, I could not process your message. Please try again.';

    // Store assistant response in history
    addToHistory(message.from, 'assistant', responseText);

    // Send reply via WhatsApp
    await whatsapp.sendMessage({ to: message.from, body: responseText });

    logEvent({
      eventType: 'whatsapp_message_sent',
      eventCategory: 'whatsapp',
      metadata: { to: message.from, tier },
    });

    // Twilio expects TwiML or 200 OK
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { status: 200, headers: { 'Content-Type': 'text/xml' } },
    );
  } catch (err) {
    console.error('[whatsapp-webhook] Error:', err instanceof Error ? err.message : err);

    // Send error reply
    try {
      await whatsapp.sendMessage({
        to: message.from,
        body: 'Sorry, something went wrong. Please try again in a moment.',
      });
    } catch { /* don't block */ }

    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { status: 200, headers: { 'Content-Type': 'text/xml' } },
    );
  }
}
