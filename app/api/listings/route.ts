export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { STUDIO } from '@/lib/constants';

// ─── Category mapping ───────────────────────────────────────────────────────
// Maps simple form categories to smart_rentals category slugs.

const CATEGORY_MAP: Record<string, string> = {
  cameras: 'cameras-optics',
  lenses: 'cameras-optics',
  lighting: 'lighting-power',
  audio: 'audio',
  grip: 'grip-motion',
  accessories: 'specialized-solutions',
  other: 'specialized-solutions',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

async function getAuthUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { supabase, user: null };
  }

  return { supabase, user };
}

// ─── GET — List authenticated user's community listings ─────────────────────

export async function GET() {
  const { supabase, user } = await getAuthUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { data, error } = await supabase
      .from('smart_rentals')
      .select('*')
      .eq('owner_id', user.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    console.error('[listings] GET error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch listings.' },
      { status: 500 },
    );
  }
}

// ─── POST — Create a community listing in smart_rentals ─────────────────────

export async function POST(request: NextRequest) {
  const { supabase, user } = await getAuthUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Require verified account to list equipment
  const { data: profile } = await supabase
    .from('profiles')
    .select('verification_status')
    .eq('id', user.id)
    .single();

  if (profile?.verification_status !== 'verified') {
    return NextResponse.json(
      { error: 'Account must be verified to list equipment.' },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();

    // Validate required fields
    const title = (body.title as string | undefined)?.trim();
    if (!title) {
      return NextResponse.json(
        { error: 'Title is required.' },
        { status: 400 },
      );
    }

    const formCategory = (body.category as string | undefined) ?? '';
    if (!formCategory) {
      return NextResponse.json(
        { error: 'Category is required.' },
        { status: 400 },
      );
    }

    const category = CATEGORY_MAP[formCategory] ?? 'specialized-solutions';

    const { data, error } = await supabase
      .from('smart_rentals')
      .insert({
        title,
        slug: slugify(title),
        description: (body.description as string | undefined)?.trim() || null,
        category,
        sub_category: (body.condition as string | undefined) || null,
        price_per_day: body.price_per_day ? parseFloat(body.price_per_day) : null,
        currency: STUDIO.currency.code,
        thumbnail_url: (body.thumbnail_url as string | undefined) ?? null,
        cover_public_id: (body.cover_public_id as string | undefined) ?? null,
        gallery: body.gallery ?? null,
        metadata: (body.location as string | undefined)
          ? { location: body.location as string }
          : null,
        owner_type: 'community',
        owner_id: user.id,
        is_published: true,
        is_available: true,
        quantity: 1,
        ranking_score: 0,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error('[listings] POST error:', err);
    return NextResponse.json(
      { error: 'Failed to create listing.' },
      { status: 500 },
    );
  }
}

// ─── PUT — Update a community listing (ownership enforced) ──────────────────

export async function PUT(request: NextRequest) {
  const { supabase, user } = await getAuthUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const id = body.id as string | undefined;

    if (!id) {
      return NextResponse.json(
        { error: 'Listing ID is required.' },
        { status: 400 },
      );
    }

    const title = (body.title as string | undefined)?.trim();
    if (!title) {
      return NextResponse.json(
        { error: 'Title is required.' },
        { status: 400 },
      );
    }

    const formCategory = (body.category as string | undefined) ?? '';
    const category = formCategory
      ? (CATEGORY_MAP[formCategory] ?? 'specialized-solutions')
      : undefined;

    const updatePayload: Record<string, unknown> = {
      title,
      slug: slugify(title),
      description: (body.description as string | undefined)?.trim() || null,
      ...(category && { category }),
      sub_category: (body.condition as string | undefined) || null,
      price_per_day: body.price_per_day ? parseFloat(body.price_per_day) : null,
      thumbnail_url: (body.thumbnail_url as string | undefined) ?? null,
      cover_public_id: (body.cover_public_id as string | undefined) ?? null,
      gallery: body.gallery ?? null,
      metadata: (body.location as string | undefined)
        ? { location: body.location as string }
        : null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('smart_rentals')
      .update(updatePayload)
      .eq('id', id)
      .eq('owner_id', user.id) // ownership check
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Listing not found or not owned by you.' },
          { status: 404 },
        );
      }
      throw error;
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error('[listings] PUT error:', err);
    return NextResponse.json(
      { error: 'Failed to update listing.' },
      { status: 500 },
    );
  }
}

// ─── DELETE — Soft-delete a community listing (ownership enforced) ──────────

export async function DELETE(request: NextRequest) {
  const { supabase, user } = await getAuthUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const id = body.id as string | undefined;

    if (!id) {
      return NextResponse.json(
        { error: 'Listing ID is required.' },
        { status: 400 },
      );
    }

    const { error } = await supabase
      .from('smart_rentals')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('owner_id', user.id); // ownership check

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[listings] DELETE error:', err);
    return NextResponse.json(
      { error: 'Failed to delete listing.' },
      { status: 500 },
    );
  }
}
