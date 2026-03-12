export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { isEmailConfigured, sendContactNotification } from '@/lib/email';
import { checkRateLimit } from '@/lib/auth';

export async function POST(req: NextRequest) {
  // H3: Rate limit contact form — 3 requests per minute per IP
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkRateLimit(`contact:${ip}`, 3, 60_000)) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait before trying again.' },
      { status: 429 },
    );
  }

  const { name, email, message, subject, phone, _hp_company, _ts } = await req.json();

  // L1: Honeypot spam protection — less predictable field name
  if (_hp_company) {
    return NextResponse.json({ success: true });
  }

  // L1: Time-based check — reject submissions faster than 2 seconds after page load
  if (_ts && typeof _ts === 'number') {
    const elapsed = Date.now() - _ts;
    if (elapsed < 2000) {
      return NextResponse.json({ success: true });
    }
  }

  if (!name || !email || !message) {
    return NextResponse.json({ error: 'name, email, and message are required.' }, { status: 400 });
  }

  // M4: Stricter email validation
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!emailRegex.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 });
  }

  try {
    if (!isEmailConfigured()) {
      // Gmail not configured — log sanitized info and return success so form still works
      console.warn('[contact] GMAIL_USER or GMAIL_APP_PASSWORD not set — message logged but not emailed.');
      // M4: Sanitize log output — truncate and strip control characters
      const sanitize = (s: string) => s.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 100);
      console.log('[contact]', { name: sanitize(name), email: sanitize(email), subject: sanitize(subject || '') });
      return NextResponse.json({ success: true });
    }

    await sendContactNotification({ name, email, subject: subject || '', message, phone: phone || undefined });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[contact] Email error:', err);
    return NextResponse.json({ error: 'Failed to send message. Please try again.' }, { status: 500 });
  }
}
