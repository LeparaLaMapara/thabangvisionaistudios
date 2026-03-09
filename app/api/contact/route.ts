export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { isEmailConfigured, sendContactNotification } from '@/lib/email';

export async function POST(req: NextRequest) {
  const { name, email, message, subject, website } = await req.json();

  // Honeypot spam protection — real users never fill this hidden field
  if (website) {
    // Return success to not tip off bots
    return NextResponse.json({ success: true });
  }

  if (!name || !email || !message) {
    return NextResponse.json({ error: 'name, email, and message are required.' }, { status: 400 });
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 });
  }

  try {
    if (!isEmailConfigured()) {
      // Gmail not configured — log and return success so form still works
      console.warn('[contact] GMAIL_USER or GMAIL_APP_PASSWORD not set — message logged but not emailed.');
      console.log('[contact]', { name, email, subject, message });
      return NextResponse.json({ success: true });
    }

    await sendContactNotification({ name, email, subject: subject || '', message });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[contact] Email error:', err);
    return NextResponse.json({ error: 'Failed to send message. Please try again.' }, { status: 500 });
  }
}
