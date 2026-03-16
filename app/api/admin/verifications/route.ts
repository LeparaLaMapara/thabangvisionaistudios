export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAllVerifications } from '@/lib/supabase/queries/verifications';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';

// ─── GET — Return all verifications for admin review ────────────────────────

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const verifications = await getAllVerifications();

    // Enrich with auth emails via service-role client
    try {
      const admin = createAdminClient();
      const enriched = await Promise.all(
        verifications.map(async (v) => {
          try {
            const { data } = await admin.auth.admin.getUserById(v.id);
            return { ...v, email: data?.user?.email ?? null };
          } catch {
            return { ...v, email: null };
          }
        }),
      );
      return NextResponse.json(enriched);
    } catch {
      // Service role key not configured — return without emails
      console.warn('[admin/verifications] SUPABASE_SERVICE_ROLE_KEY not set — emails unavailable.');
      return NextResponse.json(verifications.map((v) => ({ ...v, email: null })));
    }
  } catch (err) {
    console.error('[admin/verifications] Error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch verifications.' },
      { status: 500 },
    );
  }
}
