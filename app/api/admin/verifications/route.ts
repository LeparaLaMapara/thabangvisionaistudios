export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAllVerifications } from '@/lib/supabase/queries/verifications';
import { requireAdmin } from '@/lib/auth';

// ─── GET — Return all verifications for admin review ────────────────────────

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

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
