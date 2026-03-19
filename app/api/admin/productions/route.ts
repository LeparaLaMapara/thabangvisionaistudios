export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { isRagEnabled, indexItem } from '@/lib/rag';

// ─── GET — List all productions (admin) ─────────────────────────────────────

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('smart_productions')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    console.error('[admin/productions] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch productions.' }, { status: 500 });
  }
}

// ─── POST — Create production (admin) ──────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('smart_productions')
      .insert(body)
      .select()
      .single();

    if (error) throw error;

    // Auto-index for RAG (non-blocking)
    if (isRagEnabled()) {
      try {
        await indexItem(supabase, 'production', data.id, data);
      } catch (e) {
        console.error('[admin/productions] RAG index error (non-blocking):', e);
      }
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error('[admin/productions] POST error:', err);
    return NextResponse.json({ error: 'Failed to create production.' }, { status: 500 });
  }
}

// ─── PUT — Update production (admin) ───────────────────────────────────────

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing id.' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('smart_productions')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Auto-index for RAG (non-blocking)
    if (isRagEnabled()) {
      try {
        await indexItem(supabase, 'production', data.id, data);
      } catch (e) {
        console.error('[admin/productions] RAG index error (non-blocking):', e);
      }
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error('[admin/productions] PUT error:', err);
    return NextResponse.json({ error: 'Failed to update production.' }, { status: 500 });
  }
}
