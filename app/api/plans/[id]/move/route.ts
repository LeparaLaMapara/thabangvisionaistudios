export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, checkRateLimit } from '@/lib/auth';
import { getFlag } from '@/lib/features';
import { SHOOT_PLAN_POLICY } from '@/lib/constants';
import { formatSaDay, saToday } from '@/lib/dates/johannesburg';
import { movePlanDate } from '@/lib/core/projects/use-cases';
import { planMoveCheck } from '@/lib/projects/move';
import { SupabasePlanMoveStore } from '@/lib/projects/store';
import { logEvent } from '@/lib/data/events';

/**
 * "Move my shoot" on the plan page.
 *   GET  ?date=YYYY-MM-DD[&date_end=]  what happens to each part (read-only, live data)
 *   POST { date, date_end? }          move the plan's date and its needs' do by dates
 * The client presses the button themselves on their own plan, so this is
 * their approval. No booking, request or payment is ever changed here.
 * Flag off: 404.
 */

function status(code: string): number {
  return code === 'bad_request' || code === 'bad_date' || code === 'same_date' ? 400 : code === 'not_found' || code === 'off' ? 404 : code === 'closed' ? 409 : 503;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getFlag('ubunye_projects'))) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  if (!(await checkRateLimit(`plan-move-check:${auth.user.id}`, 30, 60_000))) {
    return NextResponse.json({ error: 'Too many checks. Wait a minute.' }, { status: 429 });
  }
  const { id } = await params;
  const url = new URL(req.url);
  try {
    const out = await planMoveCheck(auth.user.id, id, url.searchParams.get('date'), url.searchParams.get('date_end'));
    if (out.kind === 'plan_move_unavailable') return NextResponse.json({ error: out.message, code: out.code }, { status: status(out.code) });
    return NextResponse.json({ from: out.from, to: out.to, parts: out.parts.map((p) => ({ line: p.line, what: p.what, action: p.action })), can_move: out.can_move });
  } catch {
    return NextResponse.json({ error: 'Could not check that just now. Try again in a moment.' }, { status: 503 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getFlag('ubunye_projects'))) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  if (!(await checkRateLimit(`plan-move:${auth.user.id}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many changes. Wait a minute.' }, { status: 429 });
  }
  const { id } = await params;
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }
  const out = await movePlanDate(new SupabasePlanMoveStore(), {
    clientId: auth.user.id,
    projectId: id,
    date: b.date,
    dateEnd: b.date_end ?? null,
    today: saToday(new Date()),
    maxDays: SHOOT_PLAN_POLICY.maxMoveDays,
    label: formatSaDay,
  });
  if (!out.ok) return NextResponse.json({ error: out.message, code: out.code }, { status: status(out.code) });
  logEvent({ eventType: 'plan_moved', eventCategory: 'booking', userId: auth.user.id, metadata: { project_id: out.projectId, date: out.date, source: 'plan_page' } });
  return NextResponse.json({ ok: true, date: out.date });
}
