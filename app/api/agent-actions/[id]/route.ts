export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { issueToken } from '@/lib/core/agent/use-cases';
import { agentDeps, APPROVALS_UNAVAILABLE } from '@/lib/agent/deps';
import { SupabaseAgentActions } from '@/lib/agent/repo';

/**
 * The approval screen for a Ubunye proposal (spec §8.7). Only the person it
 * was prepared for can load it. Loading it issues a fresh single-use approval
 * token (earlier tokens stop working); the model never sees a token.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { id } = await params;
  const deps = agentDeps();
  if (!deps) return NextResponse.json({ error: APPROVALS_UNAVAILABLE }, { status: 503 });
  try {
    const out = await issueToken(deps, { actionId: id, userId: auth.user.id });
    if (!out.ok) return NextResponse.json({ error: out.message, code: out.code }, { status: out.code === 'not_found' ? 404 : 409 });
    return NextResponse.json({ summary: out.summary, token: out.token, expires_at: out.expiresAt }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[agent-actions] approval load failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Could not load this proposal just now.' }, { status: 503 });
  }
}

/** The person declined the proposal. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { id } = await params;
  try {
    const repo = new SupabaseAgentActions();
    const a = await repo.get(id);
    if (!a || a.userId !== auth.user.id) return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 });
    await repo.finish(id, 'cancelled', { by: 'customer' });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Could not cancel just now.' }, { status: 503 });
  }
}
