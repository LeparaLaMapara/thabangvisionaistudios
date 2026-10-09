import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Signer } from '@/lib/core/agent/approval';
import type { AgentActionRecord, AgentActionRepository, AgentDeps, ApprovalSummary } from '@/lib/core/agent/use-cases';

export class FakeClock {
  t: number;
  constructor(iso = '2026-10-09T10:00:00.000Z') {
    this.t = new Date(iso).getTime();
  }
  now(): Date {
    return new Date(this.t);
  }
  advanceMinutes(m: number): void {
    this.t += m * 60_000;
  }
}

export function hmacSigner(secret = 'test-secret-that-is-at-least-32-characters-long'): Signer {
  const mac = (p: string) => createHmac('sha256', secret).update(p).digest();
  return {
    sign: (p) => mac(p).toString('base64url'),
    verify: (p, sig) => {
      const given = Buffer.from(sig, 'base64url');
      const expected = mac(p);
      return given.length === expected.length && timingSafeEqual(given, expected);
    },
  };
}

/** In-memory agent_actions, with the same compare-and-set and supersede rules as migration 074. */
export class FakeAgentActions implements AgentActionRepository {
  rows = new Map<string, AgentActionRecord>();
  constructor(private clock: FakeClock) {}
  async insertPrepared(a: Omit<AgentActionRecord, 'state'>): Promise<void> {
    for (const r of this.rows.values()) {
      if (r.userId === a.userId && r.conversationId === a.conversationId && r.kind === a.kind && r.state === 'prepared') r.state = 'superseded';
    }
    this.rows.set(a.id, { ...a, state: 'prepared' });
  }
  async get(id: string): Promise<AgentActionRecord | null> {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }
  async pending(userId: string, conversationId: string | null, now: Date): Promise<AgentActionRecord | null> {
    const hits = [...this.rows.values()].filter((r) => r.userId === userId && r.conversationId === conversationId && r.state === 'prepared' && new Date(r.expiresAt) > now);
    return hits.length ? { ...hits[hits.length - 1] } : null;
  }
  async rotateNonce(id: string, userId: string, nonceHash: string, now: Date): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r || r.userId !== userId || r.state !== 'prepared' || new Date(r.expiresAt) <= now) return false;
    r.nonceHash = nonceHash;
    return true;
  }
  async claim(id: string, userId: string, nonceHash: string, now: Date): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r || r.userId !== userId || r.state !== 'prepared' || r.nonceHash !== nonceHash || new Date(r.expiresAt) <= now) return false;
    r.state = 'committing';
    return true;
  }
  async finish(id: string, state: 'committed' | 'failed' | 'cancelled'): Promise<void> {
    const r = this.rows.get(id);
    if (!r) return;
    if (state === 'cancelled' ? r.state === 'prepared' : r.state === 'committing') r.state = state;
  }
}

let seq = 0;
export function agentDepsFor(clock: FakeClock, repo = new FakeAgentActions(clock), signer = hmacSigner()): AgentDeps & { repo: FakeAgentActions } {
  return {
    repo,
    signer,
    clock,
    newId: () => `act-${++seq}`,
    newNonce: () => `nonce-${++seq}-${Math.random().toString(36).slice(2)}`,
    hash: (s) => `h(${s})`,
  };
}

export function summary(totalCents: number, title = 'Sony FX3'): ApprovalSummary {
  return {
    title,
    period: '2026-10-17 to 2026-10-19 (2 days)',
    lines: [{ label: 'Hire', amountCents: totalCents - 100_000 }],
    depositCents: 100_000,
    totalCents,
    collection: null,
    cancellationPolicy: 'policy',
    nextStep: 'next',
  };
}
