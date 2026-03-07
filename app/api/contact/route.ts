import { NextRequest, NextResponse } from 'next/server';

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
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      // Resend not configured — log and return success so form still works
      console.warn('[contact] RESEND_API_KEY not set — message logged but not emailed.');
      console.log('[contact]', { name, email, subject, message });
      return NextResponse.json({ success: true });
    }

    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);

    await resend.emails.send({
      from: 'ThabangVision <noreply@thabangvision.com>',
      to: ['studio@thabangvision.com'],
      subject: subject ? `[Contact] ${subject}` : `[Contact] Message from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[contact] Resend error:', err);
    return NextResponse.json({ error: 'Failed to send message. Please try again.' }, { status: 500 });
  }
}
