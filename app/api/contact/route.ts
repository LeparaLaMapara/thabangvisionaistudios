import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/contact
 * TODO: replace console.log with Resend / SendGrid / Supabase insert.
 */
export async function POST(req: NextRequest) {
  const { name, email, message, subject } = await req.json();

  if (!name || !email || !message) {
    return NextResponse.json(
      { error: 'name, email, and message are required.' },
      { status: 400 },
    );
  }

  // TODO: integrate with email provider or Supabase
  console.log('Contact submission:', { name, email, subject, message });

  return NextResponse.json({ success: true });
}
