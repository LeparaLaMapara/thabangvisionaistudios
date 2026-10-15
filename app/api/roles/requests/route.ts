export const dynamic = 'force-dynamic';

import { NextResponse, type NextRequest } from 'next/server';
import { rolesOffResponse } from '@/lib/roles/flag';
import { checkRateLimit } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createBookingRequest, getMyPersonRoles, getPublicRoleProfile } from '@/lib/supabase/queries/roles';
import { bookingTotal, effectiveUnit, pricedByDays } from '@/lib/roles';

/**
 * Ask to book a person: who, where, when. No payment (payment for roles is
 * not built). POST { person_role_id, date, arrival, hours, area, address?, note? }
 * -> { id }. The address is never shown to the person until a booking is
 * confirmed (lib/roles/reveal.ts).
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const off = await rolesOffResponse();
  if (off) return off;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  if (!(await checkRateLimit(`roles-request:${user.id}`, 10, 60 * 60_000))) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
  }

  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }
  const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && !/[<>]/.test(v) ? v.trim().slice(0, max) : null);
  const id = typeof b.person_role_id === 'string' ? b.person_role_id : '';
  // Days (like Rentals) or one date; sorted, unique, from today on.
  const rawDates = Array.isArray(b.dates) ? b.dates : typeof b.date === 'string' ? [b.date] : [];
  const dates = [...new Set(rawDates.filter((d): d is string => typeof d === 'string' && DATE.test(d)))].sort().slice(0, 14);
  const date = dates[0] ?? null;
  const arrival = typeof b.arrival === 'string' && TIME.test(b.arrival) ? b.arrival : null;
  const hours = Number(b.hours);
  const area = text(b.area, 80);
  if (!date || !arrival || !area || !Number.isFinite(hours) || hours < 0.5 || hours > 24) {
    return NextResponse.json({ error: 'Add the date, the arrival time, how long, and the area.' }, { status: 400 });
  }
  if (date < new Date().toISOString().slice(0, 10)) return NextResponse.json({ error: 'Pick dates from today on.' }, { status: 400 });

  try {
    const profile = await getPublicRoleProfile(id);
    if (!profile) return NextResponse.json({ error: 'That profile is not available.' }, { status: 404 });
    // Nobody books themselves (a self-booking would grow their own record).
    if ((await getMyPersonRoles(user.id)).some((r) => r.id === profile.personRole.id)) {
      return NextResponse.json({ error: 'That is your own profile.' }, { status: 409 });
    }
    // The one price, worked out here from the profile, never from the browser.
    const unit = effectiveUnit(profile.role.pricing_unit, profile.personRole.pricing_unit);
    const price = profile.personRole.price_cents ?? profile.role.suggested_price_cents.typical;
    const total = bookingTotal(unit, price, { days: pricedByDays(unit) ? dates.length : 1, hours });
    const requestId = await createBookingRequest({
      personRoleId: profile.personRole.id,
      clientId: user.id,
      date,
      arrival,
      hours: Math.round(hours * 2) / 2,
      area,
      address: text(b.address, 200),
      note: text(b.note, 500),
      dates: pricedByDays(unit) ? dates : [date],
      unit,
      totalCents: total.totalCents,
    });
    return NextResponse.json({ id: requestId }, { status: 201 });
  } catch {
    console.error('[roles/requests] failed');
    return NextResponse.json({ error: 'Could not send the request. Please try again.' }, { status: 500 });
  }
}
