export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { isRagEnabled, indexItem } from '@/lib/rag';

// ─── GET — List all rentals (admin) ─────────────────────────────────────────

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('smart_rentals')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    console.error('[admin/rentals] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch rentals.' }, { status: 500 });
  }
}

// ─── POST — Create rental (admin) ──────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('smart_rentals')
      .insert(body)
      .select()
      .single();

    if (error) throw error;

    // Auto-index for RAG (non-blocking)
    if (isRagEnabled()) {
      try {
        await indexItem(supabase, 'rental', data.id, data);
      } catch (e) {
        console.error('[admin/rentals] RAG index error (non-blocking):', e);
      }
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error('[admin/rentals] POST error:', err);
    return NextResponse.json({ error: 'Failed to create rental.' }, { status: 500 });
  }
}

// ─── PUT — Update rental (admin) ───────────────────────────────────────────

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
      .from('smart_rentals')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Auto-index for RAG (non-blocking)
    if (isRagEnabled()) {
      try {
        await indexItem(supabase, 'rental', data.id, data);
      } catch (e) {
        console.error('[admin/rentals] RAG index error (non-blocking):', e);
      }
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error('[admin/rentals] PUT error:', err);
    return NextResponse.json({ error: 'Failed to update rental.' }, { status: 500 });
  }
}
