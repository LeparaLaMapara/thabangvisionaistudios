import { systemClock } from '@/lib/core/ports';
import type { AgentDeps } from '@/lib/core/agent/use-cases';
import { SupabaseAgentActions } from './repo';
import { approvalSigner, newActionId, newNonce, sha256 } from './signer';

/** Wiring for the agent use cases. Null when approvals are not configured (no secret). */
export function agentDeps(): AgentDeps | null {
  const signer = approvalSigner();
  if (!signer) return null;
  return { repo: new SupabaseAgentActions(), signer, clock: systemClock, newId: newActionId, newNonce, hash: sha256 };
}

export const APPROVALS_UNAVAILABLE = 'Booking through Ubunye is not available right now. You can book the same thing on the website.';
