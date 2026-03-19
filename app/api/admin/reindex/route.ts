export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { isRagEnabled, reindexAll } from '@/lib/rag';

// ─── POST — Reindex all content embeddings (admin only) ─────────────────────

export async function POST() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  if (!isRagEnabled()) {
    return NextResponse.json(
      { error: 'RAG is not enabled. Set RAG_ENABLED=true to use this endpoint.' },
      { status: 400 },
    );
  }

  try {
    const supabase = createAdminClient();
    const result = await reindexAll(supabase);

    return NextResponse.json({
      success: true,
      indexed: result.indexed,
      errors: result.errors,
      duration: result.duration,
    });
  } catch (err) {
    console.error('[admin/reindex] Error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'Reindex failed. Check server logs.' },
      { status: 500 },
    );
  }
}
