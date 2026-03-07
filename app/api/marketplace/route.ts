import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const category = searchParams.get('category');

  let query = supabase
    .from('listings')
    .select(
      'id, user_id, type, title, slug, price, pricing_model, currency, category, sub_category, thumbnail_url, location, condition, is_published, is_featured, tags, created_at',
    )
    .eq('is_published', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (type) query = query.eq('type', type);
  if (category) query = query.eq('category', category);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const {
    type,
    title,
    slug,
    description,
    price,
    pricing_model,
    currency,
    category,
    sub_category,
    thumbnail_url,
    cover_public_id,
    gallery,
    location,
    condition,
    is_published,
    tags,
    features,
  } = body;

  if (!title || !slug || !type || price === undefined) {
    return NextResponse.json(
      { error: 'title, slug, type, and price are required.' },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from('listings')
    .insert({
      user_id: user.id,
      type,
      title: title.trim(),
      slug: slug.trim(),
      description: description?.trim() || null,
      price,
      pricing_model: pricing_model ?? 'fixed',
      currency: currency ?? 'ZAR',
      category: category?.trim() || null,
      sub_category: sub_category?.trim() || null,
      thumbnail_url: thumbnail_url || null,
      cover_public_id: cover_public_id || null,
      gallery: gallery || null,
      location: location?.trim() || null,
      condition: condition || null,
      is_published: is_published ?? false,
      is_featured: false,
      tags: tags || null,
      features: features || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
