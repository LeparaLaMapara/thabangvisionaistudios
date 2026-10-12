export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * Creators an admin can give a booking to: ID checked, not suspended.
 * Used by the "Choose creator" picker, so nobody has to type an id.
 */

export interface CreatorOption {
  id: string;
  name: string;
  place: string | null;
  skills: string[];
  hourlyRate: number | null;
  availableForHire: boolean;
}

function clean(q: string): string {
  return q.replace(/[,()*%\\:"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const q = clean(request.nextUrl.searchParams.get('q') ?? '');
  const db = createAdminClient();
  let query = db
    .from('profiles')
    .select('id, display_name, first_name, last_name, city, location, specializations, skills, hourly_rate, available_for_hire, crew_slug')
    .eq('verification_status', 'verified')
    .or('is_suspended.is.null,is_suspended.eq.false')
    .order('available_for_hire', { ascending: false })
    .order('display_name', { ascending: true })
    .limit(30);
  if (q.length >= 2) {
    const like = `%${q}%`;
    query = query.or(`display_name.ilike.${like},first_name.ilike.${like},last_name.ilike.${like},city.ilike.${like},crew_slug.ilike.${like}`);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[admin/creators] list failed:', error.message);
    return NextResponse.json({ error: 'Could not load creators.' }, { status: 500 });
  }

  type Row = {
    id: string; display_name: string | null; first_name: string | null; last_name: string | null; city: string | null;
    location: string | null; specializations: string[] | null; skills: string[] | null; hourly_rate: number | null;
    available_for_hire: boolean | null; crew_slug: string | null;
  };
  const creators: CreatorOption[] = ((data ?? []) as Row[]).map((p) => ({
    id: p.id,
    name: p.display_name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unnamed creator',
    place: p.city || p.location || null,
    skills: [...(p.specializations ?? []), ...(p.skills ?? [])].slice(0, 4),
    hourlyRate: p.hourly_rate,
    availableForHire: Boolean(p.available_for_hire),
  }));

  return NextResponse.json({ creators }, { headers: { 'Cache-Control': 'private, no-store' } });
}
