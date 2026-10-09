export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/auth';
import { clientIp } from '@/lib/http/clientIp';
import { hashIp } from '@/lib/data/chat-history';
import { CLIENT_FUNNEL_STAGES, isFunnelStage } from '@/lib/core/analytics/funnel';
import { trackFunnel } from '@/lib/analytics/funnel';

/**
 * The two funnel stages a browser reports itself (spec §9.6): viewing a
 * listing and choosing dates. Everything later is recorded by the server
 * where it happens. Ids only: the body may carry a rental id and a day count,
 * nothing else is kept. The network address is used only for the rate limit
 * and is not stored.
 */
export async function POST(request: NextRequest) {
  const ip = clientIp(request.headers);
  if (!(await checkRateLimit(`funnel:${hashIp(ip)}`, 60, 60_000))) {
    return new NextResponse(null, { status: 204 });
  }
  let body: { stage?: unknown; rentalId?: unknown; days?: unknown; surface?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (!isFunnelStage(body.stage) || !CLIENT_FUNNEL_STAGES.includes(body.stage)) {
    return NextResponse.json({ error: 'Unknown stage.' }, { status: 400 });
  }
  let userId: string | null = null;
  try {
    const { data } = await (await createClient()).auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    /* signed out, or the session could not be read: counted without an account */
  }
  trackFunnel(body.stage, {
    userId,
    meta: {
      rentalId: typeof body.rentalId === 'string' ? body.rentalId : null,
      days: typeof body.days === 'number' && Number.isInteger(body.days) && body.days > 0 && body.days < 400 ? body.days : null,
      surface: typeof body.surface === 'string' ? body.surface : null,
    },
  });
  return new NextResponse(null, { status: 204 });
}
