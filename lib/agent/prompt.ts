import type { AgentActionRecord } from '@/lib/core/agent/use-cases';
import { sanitiseForPrompt } from '@/lib/ubunye/sanitise';

const rands = (cents: number): string => `R${(cents / 100).toFixed(2)}`;

/**
 * The proposal waiting for this person's approval, for the system prompt. Read
 * from the server on every turn, so a bare "yes" refers to it (spec §8.9). The
 * model is told it cannot approve anything itself.
 */
export function pendingProposalBlock(a: AgentActionRecord): string {
  const s = a.summary;
  return `===== PROPOSAL WAITING FOR APPROVAL (server state) =====
Proposal ${a.id}: ${sanitiseForPrompt(s.title)} | ${sanitiseForPrompt(s.period)} | total ${rands(s.totalCents)}${s.depositCents ? ` (incl. ${rands(s.depositCents)} refundable deposit)` : ''}.
Expires: ${a.expiresAt}.
If the person says yes, ok, go ahead or similar, it refers to THIS proposal. You cannot approve it yourself and no tool commits it: tell them to press Approve on the card above (or call get_pending_proposal to show the card again). If they want different dates, hours or items, prepare a new proposal; the new one replaces this one. If they say no or cancel, call cancel_proposal.
===== END PROPOSAL =====`;
}
