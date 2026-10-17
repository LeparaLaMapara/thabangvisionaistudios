export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, checkRateLimit } from '@/lib/auth';
import { getFlag } from '@/lib/features';
import { closeProject } from '@/lib/core/projects/use-cases';
import { SupabaseProjectStore } from '@/lib/projects/store';

/** Close the client's own open plan. Bookings and requests in it are not touched. Flag off: 404. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getFlag('ubunye_projects'))) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  if (!(await checkRateLimit(`plan-close:${auth.user.id}`, 20, 60_000))) {
    return NextResponse.json({ error: 'Too many changes. Wait a minute.' }, { status: 429 });
  }
  const { id } = await params;
  const out = await closeProject(new SupabaseProjectStore(), { clientId: auth.user.id, projectId: id });
  if (out.ok) return NextResponse.json({ ok: true });
  return NextResponse.json({ error: out.message, code: out.code }, { status: out.code === 'not_found' || out.code === 'off' || out.code === 'bad_request' ? 404 : 503 });
}
