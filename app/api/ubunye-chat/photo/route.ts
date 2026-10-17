export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/auth';
import { getFlag } from '@/lib/features';
import { createClient } from '@/lib/supabase/server';
import { STUDIO } from '@/lib/constants';
import { clientIp } from '@/lib/http/clientIp';
import { hashIp } from '@/lib/data/chat-history';
import { parsePhotoDataUrl } from '@/lib/ubunye/photo';
import { readPhoto } from '@/lib/ai/photo-reader';

/**
 * POST { image: "data:image/jpeg;base64,..." } -> { text: "Photo the client sent: ..." }
 *
 * A photo a client adds to the Ubunye chat, read once by the free Gemma 4
 * model. The photo is never stored or logged; only the short description is
 * returned, and the chat window adds it to the client's message as text.
 * Flag off (ubunye_projects): 404.
 */

const TEN_MINUTES = 10 * 60_000;

export async function POST(req: NextRequest) {
  if (!(await getFlag('ubunye_projects'))) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const { photoMaxBytes, photosPerTenMinutes, guestPhotosPerTenMinutes } = STUDIO.security.chat;
  // base64 is about 4/3 of the bytes, plus the JSON around it.
  const length = Number(req.headers.get('content-length') ?? '0');
  if (!Number.isFinite(length) || length > Math.ceil(photoMaxBytes * 1.4) + 1024) {
    return NextResponse.json({ error: 'That photo is too big. Try a smaller one.' }, { status: 413 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const who = user ? `u:${user.id}` : `g:${hashIp(clientIp(req.headers))}`;
  if (!(await checkRateLimit(`ubunye-photo:${who}`, user ? photosPerTenMinutes : guestPhotosPerTenMinutes, TEN_MINUTES))) {
    return NextResponse.json({ error: 'That is a lot of photos for now. Try again in a few minutes, or tell me in words.' }, { status: 429 });
  }

  let body: { image?: unknown };
  try {
    body = (await req.json()) as { image?: unknown };
  } catch {
    return NextResponse.json({ error: 'That is not a photo we can read.' }, { status: 400 });
  }
  const photo = parsePhotoDataUrl(body.image, photoMaxBytes);
  if (!photo.ok) return NextResponse.json({ error: photo.message }, { status: photo.code === 'too_big' ? 413 : 400 });

  const reading = await readPhoto(photo.base64, photo.mime, user?.id ?? null);
  if (reading.ok) return NextResponse.json({ text: reading.text });
  if (reading.code === 'busy') {
    return NextResponse.json({ error: 'The photo reader is busy right now. Try again in a minute, or tell me in words.' }, { status: 429 });
  }
  return NextResponse.json({ error: 'I could not read that photo. Tell me in words what you want.' }, { status: 503 });
}
