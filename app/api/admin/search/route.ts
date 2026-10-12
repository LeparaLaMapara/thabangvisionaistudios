export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, rateLimitAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { formatRand } from '@/lib/format/money';

/**
 * One search box for the whole admin: people, gear, bookings, productions and
 * press. Returns at most a few of each, with where to go.
 */

export interface SearchHit {
  kind: 'person' | 'gear' | 'gear-booking' | 'service-booking' | 'production' | 'press';
  label: string;
  sub: string;
  href: string;
}

/** Characters PostgREST treats as syntax inside or() filters. */
function clean(q: string): string {
  return q.replace(/[,()*%\\:"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const limited = await rateLimitAdmin(auth.user.id, 'standard');
  if (limited) return limited;

  const q = clean(request.nextUrl.searchParams.get('q') ?? '');
  if (q.length < 2) return NextResponse.json({ hits: [] });

  const db = createAdminClient();
  const like = `%${q}%`;

  const [people, gear, svc, prods, press] = await Promise.all([
    db.from('profiles')
      .select('id, display_name, first_name, last_name, phone, role, verification_status')
      .or(`display_name.ilike.${like},first_name.ilike.${like},last_name.ilike.${like},phone.ilike.${like}`)
      .order('created_at', { ascending: false })
      .limit(6),
    db.from('smart_rentals')
      .select('id, title, brand, price_per_day')
      .or(`title.ilike.${like},brand.ilike.${like},model.ilike.${like},serial_number.ilike.${like}`)
      .is('deleted_at', null)
      .limit(5),
    db.from('bookings')
      .select('id, reference, client_email, status, total')
      .or(`reference.ilike.${like},client_email.ilike.${like}`)
      .order('created_at', { ascending: false })
      .limit(5),
    db.from('smart_productions').select('id, title, client').or(`title.ilike.${like},client.ilike.${like}`).is('deleted_at', null).limit(4),
    db.from('press').select('id, title, is_published').ilike('title', like).is('deleted_at', null).limit(4),
  ]);

  const hits: SearchHit[] = [];

  type Person = { id: string; display_name: string | null; first_name: string | null; last_name: string | null; phone: string | null; role: string | null; verification_status: string | null };
  for (const p of (people.data ?? []) as Person[]) {
    const name = p.display_name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unnamed person';
    const bits = [p.role === 'admin' ? 'Admin' : null, p.verification_status === 'verified' ? 'ID checked' : p.verification_status === 'pending' ? 'ID waiting' : null, p.phone].filter(Boolean);
    hits.push({ kind: 'person', label: name, sub: bits.join(' · ') || 'Person', href: `/admin/users?q=${encodeURIComponent(name)}` });
  }
  // One shortcut to the best match's gear bookings, not one per person.
  const top = (people.data ?? [])[0] as Person | undefined;
  if (top) {
    const name = top.display_name?.trim() || [top.first_name, top.last_name].filter(Boolean).join(' ');
    if (name) hits.push({ kind: 'gear-booking', label: `${name}'s gear bookings`, sub: 'Gear hire', href: `/admin/bookings?q=${encodeURIComponent(name)}` });
  }

  for (const g of (gear.data ?? []) as { id: string; title: string; brand: string | null; price_per_day: number | null }[]) {
    hits.push({ kind: 'gear', label: g.title, sub: [g.brand, g.price_per_day ? `${formatRand(g.price_per_day)} a day` : null].filter(Boolean).join(' · ') || 'Gear', href: '/admin/rentals' });
  }

  for (const b of (svc.data ?? []) as { id: string; reference: string | null; client_email: string | null; status: string; total: number | null }[]) {
    hits.push({ kind: 'service-booking', label: `Booking ${b.reference ?? ''}`.trim(), sub: [b.client_email, b.status.replace(/_/g, ' ')].filter(Boolean).join(' · '), href: `/admin/service-bookings?open=${b.id}` });
  }

  for (const p of (prods.data ?? []) as { id: string; title: string; client: string | null }[]) {
    hits.push({ kind: 'production', label: p.title, sub: p.client ? `Production for ${p.client}` : 'Production', href: '/admin/projects' });
  }

  for (const p of (press.data ?? []) as { id: string; title: string; is_published: boolean }[]) {
    hits.push({ kind: 'press', label: p.title, sub: p.is_published ? 'Press story, published' : 'Press story, draft', href: '/admin/press' });
  }

  return NextResponse.json({ hits }, { headers: { 'Cache-Control': 'private, no-store' } });
}
