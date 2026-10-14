export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { routeQuery, generateWithFallback } from '@/lib/ai';
import { createAdminClient } from '@/lib/supabase/server';
import { buildSystemPrompt, fetchPlatformData } from '@/lib/ubunye/system-prompt';
import { whatsapp, whatsappProviderName } from '@/lib/whatsapp';
import { meta, metaChallenge, metaSendConfigured, parseMetaInbound, verifyMetaSignature } from '@/lib/whatsapp/meta';
import type { WhatsAppMessage } from '@/lib/whatsapp';
import { logEvent } from '@/lib/data/events';
import { confirmFromWhatsApp, supabasePhoneVerifyStore } from '@/lib/phone-verify';
import { maskPhone, phoneCodeSecret } from '@/lib/sms/phone';
import { checkRateLimit } from '@/lib/auth';
import { STUDIO } from '@/lib/constants';

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

// ─── Meta Cloud API: phone checks by inbound message ───────────────────────
// docs/operations/whatsapp-setup.md. Message bodies and full numbers are never
// logged; only the number is ever stored (on the profile, once confirmed).

/** "27821234567" -> "***4567", for logs. */
const maskWaId = (waId: string): string => `***${waId.slice(-4)}`;

/** Meta's handshake when the callback URL is saved in the app dashboard. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const challenge = metaChallenge(request.nextUrl.searchParams, (process.env.WHATSAPP_VERIFY_TOKEN ?? '').trim());
  if (challenge === null) return new NextResponse('Forbidden', { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

/** A free-form reply inside the customer service window, at most once per inbound message. */
async function replyOnce(message: WhatsAppMessage, body: string): Promise<void> {
  if (!metaSendConfigured()) return;
  if (message.messageId && !(await checkRateLimit(`wa-reply:${message.messageId}`, 1, 86_400_000))) return;
  const sent = await meta.sendMessage({ to: message.from, body });
  if (!sent.success) console.warn('[whatsapp/verify] reply not sent to', maskWaId(message.from));
}

async function handleMeta(request: NextRequest): Promise<NextResponse> {
  const appSecret = (process.env.WHATSAPP_APP_SECRET ?? '').trim();
  if (!appSecret) return new NextResponse('WhatsApp not configured', { status: 503 });

  // The signature covers the exact bytes Meta sent, so read the raw body first.
  const rawBody = await request.text();
  if (!verifyMetaSignature(rawBody, request.headers.get('x-hub-signature-256'), appSecret)) {
    return new NextResponse('Invalid signature', { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse('Invalid payload', { status: 400 });
  }

  // Delivery statuses, other events and non-text messages: nothing to do.
  const messages = parseMetaInbound(payload);
  if (messages.length === 0) return new NextResponse('ok', { status: 200 });

  const store = supabasePhoneVerifyStore(createAdminClient());
  const secret = phoneCodeSecret();
  let failed = false;
  for (const message of messages) {
    try {
      const outcome = await confirmFromWhatsApp(message, { store, secret });
      if (outcome.kind === 'confirmed') {
        console.info('[whatsapp/verify] confirmed', maskPhone(outcome.phone));
        logEvent({ eventType: 'phone_verified', eventCategory: 'verification', userId: outcome.userId, metadata: { channel: 'whatsapp' } });
        await replyOnce(message, STUDIO.phoneVerify.confirmedReply);
      } else if (outcome.kind === 'no_match') {
        console.info('[whatsapp/verify] code did not match for', maskWaId(message.from));
        await replyOnce(message, STUDIO.phoneVerify.unmatchedReply);
      }
      // no_code (ordinary chat), not_sa_mobile, already_done (duplicate): ignored.
    } catch (err) {
      // A 500 makes Meta retry; confirming is idempotent.
      failed = true;
      console.error('[whatsapp/verify] could not check a message from', maskWaId(message.from), err instanceof Error ? err.message : '');
    }
  }
  return failed ? new NextResponse('Retry', { status: 500 }) : new NextResponse('ok', { status: 200 });
}

// ─── POST handler ───────────────────────────────────────────────────────────
// Meta Cloud API when it is the active provider (WHATSAPP_PROVIDER=meta, or
// WHATSAPP_APP_SECRET set); otherwise the older Twilio chat bot below.

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (whatsappProviderName() === 'meta') return handleMeta(request);
  return handleTwilio(request);
}

async function handleTwilio(request: NextRequest): Promise<NextResponse> {
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
    // No phone number or name: platform_events is analytics, not a contact
    // record (a hash of a phone number is easily reversed, so none is kept).
    metadata: {},
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

    // Route to the fast/smart tier, then let the gateway fail over across
    // providers if that one is down. A WhatsApp reply is unattended — a provider
    // blip must not become silence to the customer.
    const { tier } = routeQuery(message.body);

    const result = await generateWithFallback({
      ref: tier,
      system: systemPrompt,
      messages: history.map(m => ({ role: m.role, content: m.content })),
      maxOutputTokens: 500,
    });

    if (result.attempts.length > 0) {
      console.warn(
        `[whatsapp] served by ${result.servedBy} after ${result.attempts.length} failover(s): `
        + result.attempts.map(a => a.provider).join(', '),
      );
    }

    const responseText = result.text || 'Sorry, I could not process your message. Please try again.';

    // Store assistant response in history
    addToHistory(message.from, 'assistant', responseText);

    // Send reply via WhatsApp
    await whatsapp.sendMessage({ to: message.from, body: responseText });

    logEvent({
      eventType: 'whatsapp_message_sent',
      eventCategory: 'whatsapp',
      metadata: { tier },
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
