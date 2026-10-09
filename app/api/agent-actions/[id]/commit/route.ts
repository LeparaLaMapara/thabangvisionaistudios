export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, checkRateLimit } from '@/lib/auth';
import { commitAction } from '@/lib/core/agent/use-cases';
import { agentDeps, APPROVALS_UNAVAILABLE } from '@/lib/agent/deps';
import { executorFor, requote } from '@/lib/agent/offers';
import { logEvent } from '@/lib/data/events';

/**
 * Commit an approved Ubunye proposal (spec §8.7). Called only by the approval
 * screen in the person's own browser session (the proxy checks the request
 * Origin): no model tool can reach it. Requires the server-issued single-use
 * token and an explicit approval; the server recomputes the price, claims the
 * proposal atomically and then runs the website's own booking step.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!(await checkRateLimit(`agent-commit:${auth.user.id}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many attempts. Wait a minute and try again.' }, { status: 429 });
  }
  const deps = agentDeps();
  if (!deps) return NextResponse.json({ error: APPROVALS_UNAVAILABLE }, { status: 503 });

  let body: { token?: unknown; approved?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  try {
    const out = await commitAction(
      { ...deps, requote, execute: executorFor(auth.user, null) },
      { actionId: id, userId: auth.user.id, token: body.token, explicitApproval: body.approved === true },
    );
    logEvent({ eventType: out.ok ? 'agent_action_committed' : 'agent_action_refused', eventCategory: 'booking', userId: auth.user.id, metadata: { actionId: id, ...(out.ok ? {} : { code: out.code }) } });
    if (!out.ok) return NextResponse.json({ error: out.message, code: out.code }, { status: out.status });
    return NextResponse.json({ ok: true, ...out.result });
  } catch (err) {
    console.error('[agent-actions] commit failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Could not complete this just now. Nothing was charged.' }, { status: 503 });
  }
}
