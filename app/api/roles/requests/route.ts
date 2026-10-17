export const dynamic = 'force-dynamic';

import { NextResponse, after, type NextRequest } from 'next/server';
import { rolesOffResponse } from '@/lib/roles/flag';
import { checkRateLimit } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createBookingRequest, getMyPersonRoles, getPublicRoleProfile } from '@/lib/supabase/queries/roles';
import { findOpenRequest } from '@/lib/supabase/queries/role-requests';
import { bookingTotal, effectiveUnit, isDuplicateRequestError, pricedByDays } from '@/lib/roles';
import { saToday } from '@/lib/dates/johannesburg';
import { notifyNewRequest } from '@/lib/roles/request-notify-server';
import { linkRequestToPlan } from '@/lib/projects/link';

/**
 * Ask to book a person: who, where, when. Nothing is paid here. POST
 * { person_role_id, date, arrival, hours, area, address?, note? } -> { id }.
 * Asking again for the same person and first day while that request is
 * still open returns it ({ id, existing: true }) instead of a second one
 * (a double submit; migration 096 holds the line under a race).
 * Once saved, the owner, the person asked (blind) and the client are told,
 * after the response is sent (lib/roles/request-notify-server.ts). The
 * address is never shown to the person until a booking is confirmed
 * (lib/roles/reveal.ts).
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
  // "Today" is South African today: in UTC, 00:00 to 02:00 would still allow yesterday.
  if (date < saToday()) return NextResponse.json({ error: 'Pick dates from today on.' }, { status: 400 });

  try {
    const profile = await getPublicRoleProfile(id);
    if (!profile) return NextResponse.json({ error: 'That profile is not available.' }, { status: 404 });
    // Nobody books themselves (a self-booking would grow their own record).
    if ((await getMyPersonRoles(user.id)).some((r) => r.id === profile.personRole.id)) {
      return NextResponse.json({ error: 'That is your own profile.' }, { status: 409 });
    }
    // Already asked (a double submit, or a second tab): the same request back.
    const existing = await findOpenRequest(user.id, profile.personRole.id, date);
    if (existing) {
      const linked = await linkRequestToPlan(user.id, b.plan_id, existing, b.need_item_id);
      return NextResponse.json({ id: existing, existing: true, ...(linked !== null ? { plan_linked: linked } : {}) }, { status: 200 });
    }
    // The one price, worked out here from the profile, never from the browser.
    const unit = effectiveUnit(profile.role.pricing_unit, profile.personRole.pricing_unit);
    const price = profile.personRole.price_cents ?? profile.role.suggested_price_cents.typical;
    const total = bookingTotal(unit, price, { days: pricedByDays(unit) ? dates.length : 1, hours });
    let requestId: string;
    try {
      requestId = await createBookingRequest({
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
    } catch (err) {
      // Two submits raced past the check above: 096 kept one; return it.
      if (!isDuplicateRequestError(err)) throw err;
      const raced = await findOpenRequest(user.id, profile.personRole.id, date);
      if (!raced) throw err;
      return NextResponse.json({ id: raced, existing: true }, { status: 200 });
    }
    after(() => notifyNewRequest(requestId).then(() => undefined));
    // Sent from a plan: add it there, after the plan service checks the plan and the request are theirs.
    const linked = await linkRequestToPlan(user.id, b.plan_id, requestId, b.need_item_id);
    return NextResponse.json({ id: requestId, ...(linked !== null ? { plan_linked: linked } : {}) }, { status: 201 });
  } catch {
    console.error('[roles/requests] failed');
    return NextResponse.json({ error: 'Could not send the request. Please try again.' }, { status: 500 });
  }
}
