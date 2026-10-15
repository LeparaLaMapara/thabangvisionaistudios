export const dynamic = 'force-dynamic';

import { NextResponse, after, type NextRequest } from 'next/server';
import { rolesOffResponse } from '@/lib/roles/flag';
import { requireAdmin } from '@/lib/auth';
import { ADMIN_REQUEST_GROUPS, listRequestsForAdmin, moveRequest, requestGroupCounts, type AdminRequestGroup } from '@/lib/supabase/queries/role-requests';
import { notifyRequestDecision, type Decision } from '@/lib/roles/request-notify-server';
import type { RequestStatus } from '@/lib/roles';

/**
 * People requests, for staff (migration 095).
 *
 *   GET   ?group=waiting (default) | accepted | booked | closed
 *   PATCH { id, action: 'accept' }        requested -> accepted. The client is
 *         emailed the amount, our bank details and their reference.
 *   PATCH { id, action: 'decline', note? } requested or accepted -> declined.
 *         The client (with the note) and the person are told.
 *   PATCH { id, action: 'paid' }          accepted -> confirmed, once the EFT
 *         shows. Both sides are told, and see each other (lib/roles/reveal.ts).
 */

const ACTIONS: Record<string, { from: RequestStatus[]; to: Decision }> = {
  accept: { from: ['requested'], to: 'accepted' },
  decline: { from: ['requested', 'accepted'], to: 'declined' },
  paid: { from: ['accepted'], to: 'confirmed' },
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const off = await rolesOffResponse();
  if (off) return off;
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const group = new URL(request.url).searchParams.get('group') ?? 'waiting';
  if (!(group in ADMIN_REQUEST_GROUPS)) return NextResponse.json({ error: 'Unknown group.' }, { status: 400 });
  try {
    const [items, counts] = await Promise.all([listRequestsForAdmin(group as AdminRequestGroup), requestGroupCounts()]);
    return NextResponse.json({ items, counts }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[admin/roles/requests] GET failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not load the requests.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const off = await rolesOffResponse();
  if (off) return off;
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }
  const id = typeof body.id === 'string' ? body.id : '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Bad id.' }, { status: 400 });
  const action = typeof body.action === 'string' ? ACTIONS[body.action] : undefined;
  if (!action) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  const rawNote = typeof body.note === 'string' ? body.note.trim() : '';
  if (/[<>]/.test(rawNote)) return NextResponse.json({ error: 'The note cannot contain < or >.' }, { status: 400 });
  const note = action.to === 'declined' && rawNote ? rawNote.slice(0, 500) : null;

  try {
    let moved = false;
    for (const from of action.from) {
      if (await moveRequest(id, from, action.to, auth.user.id, note)) {
        moved = true;
        break;
      }
    }
    if (!moved) return NextResponse.json({ error: 'This request has already moved on. Reload to see where it is.' }, { status: 409 });
    after(() => notifyRequestDecision(id, action.to, note).then(() => undefined));
    return NextResponse.json({ ok: true, status: action.to });
  } catch (err) {
    console.error('[admin/roles/requests] PATCH failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not save that.' }, { status: 500 });
  }
}
