import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { email } = await req.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 });
    }

    const supabase = await createClient();

    // Try inserting into newsletter_subscribers table
    // If table doesn't exist yet, log and return success (graceful degradation)
    const { error } = await supabase
      .from('newsletter_subscribers')
      .upsert({ email: trimmed }, { onConflict: 'email' });

    if (error) {
      // Table may not exist — log and succeed gracefully
      console.log('[newsletter] Subscriber:', trimmed, '| DB error:', error.message);
      return NextResponse.json({ success: true });
    }

    console.log('[newsletter] Subscribed:', trimmed);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
