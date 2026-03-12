export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isRagEnabled, indexItem } from '@/lib/rag';

// ─── GET — List all press articles (admin) ──────────────────────────────────

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('press')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    console.error('[admin/press] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch press articles.' }, { status: 500 });
  }
}

// ─── POST — Create press article (admin) ───────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('press')
      .insert(body)
      .select()
      .single();

    if (error) throw error;

    // Auto-index for RAG (non-blocking)
    if (isRagEnabled()) {
      try {
        await indexItem(supabase, 'press', data.id, data);
      } catch (e) {
        console.error('[admin/press] RAG index error (non-blocking):', e);
      }
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error('[admin/press] POST error:', err);
    return NextResponse.json({ error: 'Failed to create press article.' }, { status: 500 });
  }
}

// ─── PUT — Update press article (admin) ────────────────────────────────────

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing id.' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('press')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Auto-index for RAG (non-blocking)
    if (isRagEnabled()) {
      try {
        await indexItem(supabase, 'press', data.id, data);
      } catch (e) {
        console.error('[admin/press] RAG index error (non-blocking):', e);
      }
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error('[admin/press] PUT error:', err);
    return NextResponse.json({ error: 'Failed to update press article.' }, { status: 500 });
  }
}
