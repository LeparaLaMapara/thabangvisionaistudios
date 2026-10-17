export const dynamic = 'force-dynamic';

import { NextResponse, after, type NextRequest } from 'next/server';
import { rolesOffResponse } from '@/lib/roles/flag';
import { checkRateLimit } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createBookingRequest, getMyPersonRoles, getPublicRoleProfile } from '@/lib/supabase/queries/roles';
import { findOpenRequest } from '@/lib/supabase/queries/role-requests';
import { sendPeopleRequest } from '@/lib/roles/request-send';
import { saToday } from '@/lib/dates/johannesburg';
import { notifyNewRequest } from '@/lib/roles/request-notify-server';
import { linkRequestToPlan } from '@/lib/projects/link';

/**
 * Ask to book a person: who, where, when. Nothing is paid here. POST
 * { person_role_id, date, arrival, hours, area, address?, note? } -> { id }.
 * Asking again for the same person and first day while that request is
 * still open returns it ({ id, existing: true }) instead of a second one
 * (a double submit; migration 096 holds the line under a race).
 * The rules live in lib/roles/request-send.ts, shared with "Ask everyone"
 * from Ubunye, so both send requests the same way.
 * Once saved, the owner, the person asked (blind) and the client are told,
 * after the response is sent (lib/roles/request-notify-server.ts). The
 * address is never shown to the person until a booking is confirmed
 * (lib/roles/reveal.ts).
 */

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

  try {
    const out = await sendPeopleRequest(user.id, b, {
      profile: getPublicRoleProfile,
      // Nobody books themselves (a self-booking would grow their own record).
      ownRoles: () => getMyPersonRoles(user.id),
      findOpen: findOpenRequest,
      create: createBookingRequest,
      today: () => saToday(),
    });
    if (out.kind === 'refused') return NextResponse.json({ error: out.message }, { status: out.status });
    if (out.kind === 'existing') {
      // Two submits raced: 096 kept one; return it as it was.
      if (out.raced) return NextResponse.json({ id: out.id, existing: true }, { status: 200 });
      // Already asked (a double submit, or a second tab): the same request back.
      const linked = await linkRequestToPlan(user.id, b.plan_id, out.id, b.need_item_id);
      return NextResponse.json({ id: out.id, existing: true, ...(linked !== null ? { plan_linked: linked } : {}) }, { status: 200 });
    }
    const requestId = out.id;
    after(() => notifyNewRequest(requestId).then(() => undefined));
    // Sent from a plan: add it there, after the plan service checks the plan and the request are theirs.
    const linked = await linkRequestToPlan(user.id, b.plan_id, requestId, b.need_item_id);
    return NextResponse.json({ id: requestId, ...(linked !== null ? { plan_linked: linked } : {}) }, { status: 201 });
  } catch {
    console.error('[roles/requests] failed');
    return NextResponse.json({ error: 'Could not send the request. Please try again.' }, { status: 500 });
  }
}
