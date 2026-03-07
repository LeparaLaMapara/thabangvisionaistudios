import { NextResponse } from 'next/server';
import { getAllVerifications } from '@/lib/supabase/queries/verifications';

// ─── GET — Return all verifications for admin review ────────────────────────

export async function GET() {
  try {
    const verifications = await getAllVerifications();
    return NextResponse.json(verifications);
  } catch (err) {
    console.error('[admin/verifications] Error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch verifications.' },
      { status: 500 },
    );
  }
}
