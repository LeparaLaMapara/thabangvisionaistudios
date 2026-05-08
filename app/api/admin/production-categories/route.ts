export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';

// ─── GET — List all categories (admin) ──────────────────────────────────────

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('production_categories')
      .select('*')
      .order('display_order', { ascending: true });

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    console.error('[admin/production-categories] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch categories.' }, { status: 500 });
  }
}

// ─── POST — Create category (admin) ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const limited = rateLimitAdmin(auth.user.id);
  if (limited) return limited;

  try {
    const body = await req.json();

    // Validate required fields
    if (!body.slug || !body.name || !body.project_type) {
      return NextResponse.json(
        { error: 'slug, name, and project_type are required.' },
        { status: 400 },
      );
    }

    // Whitelist allowed fields
    const payload = {
      slug: body.slug,
      name: body.name,
      description: body.description ?? null,
      sub_types: body.sub_types ?? [],
      cover_image_url: body.cover_image_url ?? null,
      cover_image_public_id: body.cover_image_public_id ?? null,
      starting_rate: body.starting_rate ?? 0,
      starting_unit: body.starting_unit ?? 'session',
      project_type: body.project_type,
      creator_keywords: body.creator_keywords ?? [],
      icon: body.icon ?? null,
      display_order: body.display_order ?? 0,
      is_published: body.is_published ?? true,
    };

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('production_categories')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error('[admin/production-categories] POST error:', err);
    return NextResponse.json({ error: 'Failed to create category.' }, { status: 500 });
  }
}

// ─── PUT — Update category (admin) ──────────────────────────────────────────

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const limited = rateLimitAdmin(auth.user.id);
  if (limited) return limited;

  try {
    const body = await req.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required.' }, { status: 400 });
    }

    // Whitelist allowed fields
    const ALLOWED = ['slug', 'name', 'description', 'sub_types', 'cover_image_url', 'cover_image_public_id', 'starting_rate', 'starting_unit', 'project_type', 'creator_keywords', 'icon', 'display_order', 'is_published'] as const;
    const updates: Record<string, unknown> = {};
    for (const key of ALLOWED) {
      if (key in body) updates[key] = body[key];
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('production_categories')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    console.error('[admin/production-categories] PUT error:', err);
    return NextResponse.json({ error: 'Failed to update category.' }, { status: 500 });
  }
}

// ─── DELETE — Delete category (admin) ───────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const limited = rateLimitAdmin(auth.user.id);
  if (limited) return limited;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id query param is required.' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Check if productions reference this category
    const { count } = await supabase
      .from('smart_productions')
      .select('id', { count: 'exact', head: true })
      .eq('production_category_id', id);

    if (count && count > 0) {
      return NextResponse.json(
        { error: `Cannot delete: ${count} production(s) reference this category. Reassign them first.` },
        { status: 409 },
      );
    }

    const { error } = await supabase
      .from('production_categories')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[admin/production-categories] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete category.' }, { status: 500 });
  }
}
