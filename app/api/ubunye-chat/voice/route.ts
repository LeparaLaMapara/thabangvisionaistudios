export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/auth';
import { getFlag } from '@/lib/features';
import { createClient } from '@/lib/supabase/server';
import { STUDIO } from '@/lib/constants';
import { clientIp } from '@/lib/http/clientIp';
import { hashIp } from '@/lib/data/chat-history';
import { parseVoiceDataUrl } from '@/lib/ubunye/voice';
import { transcribeVoice } from '@/lib/ai/voice-reader';

/**
 * POST { audio: "data:audio/webm;base64,..." } -> { text: "<what they said>" }
 *
 * A voice note recorded in Plan, transcribed once. The audio is never stored
 * or logged; the chat window sends the words as the client's message.
 * Flag off (ubunye_projects): 404.
 */

const TEN_MINUTES = 10 * 60_000;

export async function POST(req: NextRequest) {
  if (!(await getFlag('ubunye_projects'))) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const { voiceMaxBytes, voiceNotesPerTenMinutes, guestVoiceNotesPerTenMinutes } = STUDIO.security.chat;
  const length = Number(req.headers.get('content-length') ?? '0');
  if (!Number.isFinite(length) || length > Math.ceil(voiceMaxBytes * 1.4) + 1024) {
    return NextResponse.json({ error: 'That voice note is too long. Keep it under a minute.' }, { status: 413 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const who = user ? `u:${user.id}` : `g:${hashIp(clientIp(req.headers))}`;
  if (!(await checkRateLimit(`ubunye-voice:${who}`, user ? voiceNotesPerTenMinutes : guestVoiceNotesPerTenMinutes, TEN_MINUTES))) {
    return NextResponse.json({ error: 'That is a lot of voice notes for now. Try again in a few minutes, or type it.' }, { status: 429 });
  }

  let body: { audio?: unknown };
  try {
    body = (await req.json()) as { audio?: unknown };
  } catch {
    return NextResponse.json({ error: 'That is not a voice note we can hear.' }, { status: 400 });
  }
  const voice = parseVoiceDataUrl(body.audio, voiceMaxBytes);
  if (!voice.ok) return NextResponse.json({ error: voice.message }, { status: voice.code === 'too_big' ? 413 : 400 });

  const reading = await transcribeVoice(voice.base64, voice.mime, user?.id ?? null);
  if (reading.ok) return NextResponse.json({ text: reading.text });
  if (reading.code === 'silent') return NextResponse.json({ error: 'I could not hear any words. Try again a little closer, or type it.' }, { status: 422 });
  if (reading.code === 'busy') return NextResponse.json({ error: 'Voice notes are busy right now. Try again in a minute, or type it.' }, { status: 429 });
  return NextResponse.json({ error: 'I could not hear that voice note. Try again, or type it.' }, { status: 503 });
}
