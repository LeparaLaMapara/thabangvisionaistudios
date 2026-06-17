export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

// ─── GET — Return all verifications for admin review ────────────────────────

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_list_verifications');

    if (error) {
      console.error('[admin/verifications] RPC error:', error.message);
      return NextResponse.json(
        { error: 'Failed to fetch verifications.' },
        { status: 500 },
      );
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error('[admin/verifications] Error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch verifications.' },
      { status: 500 },
    );
  }
}
