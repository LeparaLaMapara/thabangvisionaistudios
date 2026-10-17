export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, checkRateLimit } from '@/lib/auth';
import { getFlag } from '@/lib/features';
import { addItem } from '@/lib/core/projects/use-cases';
import { SupabaseProjectStore } from '@/lib/projects/store';

/**
 * "Add to this plan": the client's own People request or gear order joins
 * their open plan. POST { kind, ref_id, replaces? }. The plan service checks
 * the plan and the booking are theirs (the database checks again). Flag off: 404.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getFlag('ubunye_projects'))) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  if (!(await checkRateLimit(`plan-items:${auth.user.id}`, 20, 60_000))) {
    return NextResponse.json({ error: 'Too many changes. Wait a minute.' }, { status: 429 });
  }
  const { id } = await params;
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }
  const out = await addItem(new SupabaseProjectStore(), { clientId: auth.user.id, projectId: id, kind: b.kind, refId: b.ref_id, replacesNeedId: b.replaces });
  if (out.ok) return NextResponse.json({ ok: true, item_id: out.itemId });
  const status = out.code === 'bad_request' ? 400 : out.code === 'not_owner' ? 403 : out.code === 'not_found' || out.code === 'off' ? 404 : out.code === 'other_plan' ? 409 : 503;
  return NextResponse.json({ error: out.message, code: out.code }, { status });
}
