export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { isRagEnabled, indexItem } from '@/lib/rag';
import { adminRentalEditConflict } from '@/lib/core/listings/review';
import { notifyDiscovery } from '@/lib/discovery/notify';
import { rentalPaths } from '@/lib/discovery/paths';

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

  const limited = await rateLimitAdmin(auth.user.id);
  if (limited) return limited;

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

    if (data?.is_published) notifyDiscovery(rentalPaths(data));
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

  const limited = await rateLimitAdmin(auth.user.id);
  if (limited) return limited;

  try {
    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing id.' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Community listings go live (or come down) through Listing review, not
    // this generic editor (migration 072 refuses the flag flip anyway).
    const { data: current, error: currentError } = await supabase
      .from('smart_rentals')
      .select('owner_type, is_published, category, slug, owner_id')
      .eq('id', id)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return NextResponse.json({ error: 'Rental not found.' }, { status: 404 });
    const conflict = adminRentalEditConflict(current, updates);
    if (conflict) {
      return NextResponse.json({ error: conflict, code: 'use_listing_review', href: '/admin/listings' }, { status: 409 });
    }

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

    // Old and new address: the slug or category may have changed.
    notifyDiscovery([...rentalPaths(current), ...rentalPaths(data)]);
    return NextResponse.json(data);
  } catch (err) {
    console.error('[admin/rentals] PUT error:', err);
    return NextResponse.json({ error: 'Failed to update rental.' }, { status: 500 });
  }
}
