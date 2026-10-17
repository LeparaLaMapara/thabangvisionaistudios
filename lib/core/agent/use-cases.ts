/**
 * Ubunye's consequential actions, as core use cases (spec §8.6–8.9). The
 * agent tools PREPARE; only an authenticated approval request COMMITS. No
 * Supabase, Next.js or AI SDK imports: storage, signing, pricing and the
 * actual booking step are ports, so the website and every future channel
 * (WhatsApp, MCP) call the same rules.
 */

import type { Clock } from '@/lib/core/ports';
import {
  APPROVAL_TTL_SECONDS,
  checkCommit,
  issueApprovalToken,
  verifyApprovalToken,
  type AgentActionKind,
  type AgentActionState,
  type Signer,
  type StoredAction,
} from './approval';

/** What the approval screen shows (spec §8.7). Amounts in integer cents. */
export interface ApprovalSummary {
  title: string;
  /**
   * Who and what, looked up by the server (creator name, location, what is
   * delivered, item make). Optional: proposals stored before it existed have none.
   */
  details?: string[];
  /** e.g. "Fri 10 Oct to Sun 12 Oct (3 days)" or "6 hours, Sat 18 Oct". */
  period: string;
  lines: { label: string; amountCents: number }[];
  depositCents: number;
  totalCents: number;
  /** Why the person must collect in person, if they must. */
  collection: string | null;
  cancellationPolicy: string;
  /** What happens when they approve (e.g. "added to your cart; you pay at checkout"). */
  nextStep: string;
  /** Nothing is paid or booked by approving (a plan): the card shows no money. */
  noCharge?: boolean;
  /** What the card says once a no-charge proposal is done ("Your plan is moved."). */
  doneMessage?: string;
}

export interface AgentActionRecord extends StoredAction {
  conversationId: string | null;
  payload: Record<string, unknown>;
  summary: ApprovalSummary;
}

export interface AgentActionRepository {
  /** Store a prepared action and supersede any earlier prepared one of the same kind in the conversation. */
  insertPrepared(a: Omit<AgentActionRecord, 'state'>): Promise<void>;
  get(id: string): Promise<AgentActionRecord | null>;
  /** The latest prepared, unexpired action for this person in this conversation. */
  pending(userId: string, conversationId: string | null, now: Date): Promise<AgentActionRecord | null>;
  /** Replace the nonce (a fresh token invalidates earlier ones). Only while prepared and unexpired. */
  rotateNonce(id: string, userId: string, nonceHash: string, now: Date): Promise<boolean>;
  /**
   * Atomically move prepared → committing when id, person and nonce match and
   * it has not expired. False when anyone else got there first (replay).
   */
  claim(id: string, userId: string, nonceHash: string, now: Date): Promise<boolean>;
  finish(id: string, state: Extract<AgentActionState, 'committed' | 'failed' | 'cancelled'>, result: Record<string, unknown>): Promise<void>;
}

/** Recomputes the server price for an action's payload (never trusts the model's numbers). */
export type Requote = (kind: AgentActionKind, payload: Record<string, unknown>) => Promise<{ ok: true; amountCents: number } | { ok: false; message: string }>;

/**
 * Performs the approved action through the same business use case the website
 * uses. It receives the amount the person approved and must refuse when its
 * own price differs (the price can move between the claim and the booking).
 */
export type Execute = (kind: AgentActionKind, payload: Record<string, unknown>, userId: string, approvedAmountCents: number) => Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; message: string }>;

export interface AgentDeps {
  repo: AgentActionRepository;
  signer: Signer;
  clock: Clock;
  newId: () => string;
  newNonce: () => string;
  hash: (s: string) => string;
}

export async function prepareAction(
  deps: AgentDeps,
  p: { userId: string; conversationId: string | null; kind: AgentActionKind; payload: Record<string, unknown>; summary: ApprovalSummary; quoteVersion?: number },
): Promise<{ actionId: string; expiresAt: string; summary: ApprovalSummary }> {
  const now = deps.clock.now();
  const expiresAt = new Date(now.getTime() + APPROVAL_TTL_SECONDS * 1000).toISOString();
  const id = deps.newId();
  await deps.repo.insertPrepared({
    id,
    userId: p.userId,
    conversationId: p.conversationId,
    kind: p.kind,
    amountCents: p.summary.totalCents,
    quoteVersion: p.quoteVersion ?? 1,
    expiresAt,
    // No token exists yet: the approval screen asks for one (issueToken), so
    // the model never sees a token.
    nonceHash: deps.hash(deps.newNonce()),
    payload: p.payload,
    summary: p.summary,
  });
  return { actionId: id, expiresAt, summary: p.summary };
}

/**
 * What the approval card shows. Read-only: loading or re-rendering a card (or
 * two cards for the same proposal) never touches the token.
 */
export async function describeAction(
  deps: Pick<AgentDeps, 'repo' | 'clock'>,
  p: { actionId: string; userId: string },
): Promise<{ ok: true; summary: ApprovalSummary; expiresAt: string; state: AgentActionState | 'expired' } | { ok: false; code: 'not_found'; message: string }> {
  const a = await deps.repo.get(p.actionId);
  if (!a || a.userId !== p.userId) return { ok: false, code: 'not_found', message: 'That proposal does not exist.' };
  const expired = a.state === 'prepared' && new Date(a.expiresAt).getTime() <= deps.clock.now().getTime();
  return { ok: true, summary: a.summary, expiresAt: a.expiresAt, state: expired ? 'expired' : a.state };
}

/**
 * Called by the approval screen only when the person presses Approve (their
 * own browser session), never by the model. Each call invalidates earlier
 * tokens for the action, so the card asks for one immediately before it commits.
 */
export async function issueToken(
  deps: AgentDeps,
  p: { actionId: string; userId: string },
): Promise<{ ok: true; token: string; summary: ApprovalSummary; expiresAt: string } | { ok: false; code: 'not_found' | 'not_pending'; message: string }> {
  const now = deps.clock.now();
  const a = await deps.repo.get(p.actionId);
  if (!a || a.userId !== p.userId) return { ok: false, code: 'not_found', message: 'That proposal does not exist.' };
  if (a.state !== 'prepared' || new Date(a.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, code: 'not_pending', message: 'That proposal is no longer waiting for approval. Ask Ubunye for a new quote.' };
  }
  const nonce = deps.newNonce();
  const rotated = await deps.repo.rotateNonce(a.id, p.userId, deps.hash(nonce), now);
  if (!rotated) return { ok: false, code: 'not_pending', message: 'That proposal is no longer waiting for approval.' };
  const exp = Math.floor(new Date(a.expiresAt).getTime() / 1000);
  const token = issueApprovalToken({ aid: a.id, sub: p.userId, kind: a.kind, amt: a.amountCents, ver: a.quoteVersion, exp, nonce }, deps.signer);
  return { ok: true, token, summary: a.summary, expiresAt: a.expiresAt };
}

/** Shown when the booking step failed part-way: the person should look before retrying. */
export const UNCERTAIN_MESSAGE = 'Something went wrong while completing this. Check your cart and bookings before asking Ubunye again.';

export type CommitOutcome =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; code: string; message: string; status: number };

/**
 * Commit an approved action (spec §8.7). Order matters: check the token and
 * the stored action, recompute the price, claim the action atomically (so a
 * replay or a double click does nothing), then execute through the business
 * use case. A failure after the claim is recorded; the action is never left
 * claimable again.
 */
export async function commitAction(
  deps: AgentDeps & { requote: Requote; execute: Execute },
  p: { actionId: string; userId: string; token: unknown; explicitApproval: boolean },
): Promise<CommitOutcome> {
  const now = deps.clock.now();
  const t = verifyApprovalToken(p.token, deps.signer, { userId: p.userId, now });
  if (!t.ok) {
    const status = t.code === 'wrong_user' ? 403 : t.code === 'expired' ? 410 : 400;
    return { ok: false, code: t.code, message: t.code === 'expired' ? 'This approval expired. Ask Ubunye for a fresh quote.' : 'This approval is not valid.', status };
  }
  if (t.claims.aid !== p.actionId) return { ok: false, code: 'mismatch', message: 'This approval is for a different proposal.', status: 400 };

  const action = await deps.repo.get(p.actionId);
  const requote = action ? await deps.requote(action.kind, action.payload) : null;
  if (requote && !requote.ok) return { ok: false, code: 'unavailable', message: requote.message, status: 409 };
  const check = checkCommit({
    action,
    claims: t.claims,
    userId: p.userId,
    nonceHash: deps.hash(t.claims.nonce),
    explicitApproval: p.explicitApproval,
    currentAmountCents: requote && requote.ok ? requote.amountCents : -1,
    now,
  });
  if (!check.ok) {
    const status = check.code === 'not_found' ? 404 : check.code === 'wrong_user' ? 403 : check.code === 'expired' ? 410 : check.code === 'not_approved' ? 400 : 409;
    return { ok: false, code: check.code, message: check.message, status };
  }

  const claimed = await deps.repo.claim(p.actionId, p.userId, deps.hash(t.claims.nonce), now);
  if (!claimed) return { ok: false, code: 'already_used', message: 'This proposal was already used.', status: 409 };

  const a = action as AgentActionRecord;
  // A thrown error means we do not know how far the booking step got, so the
  // message does not claim nothing happened.
  const done = await deps.execute(a.kind, a.payload, p.userId, a.amountCents).catch(
    () => ({ ok: false as const, thrown: true, message: UNCERTAIN_MESSAGE }),
  );
  // Recording the outcome must not turn a completed booking into an error
  // (the person would retry and book twice). If it fails, the row stays in
  // 'committing', which no token can claim again; see docs/ai/ubunye-agent.md.
  const record = (state: 'committed' | 'failed', result: Record<string, unknown>) =>
    deps.repo.finish(p.actionId, state, result).catch(() => undefined);
  if (!done.ok) {
    await record('failed', { message: done.message, ...('thrown' in done ? { uncertain: true } : {}) });
    return { ok: false, code: 'failed', message: done.message, status: 409 };
  }
  await record('committed', done.result);
  return { ok: true, result: done.result };
}

/** The person changed their mind: the pending proposal can no longer be approved. */
export async function cancelPending(deps: AgentDeps, p: { userId: string; conversationId: string | null }): Promise<boolean> {
  const a = await deps.repo.pending(p.userId, p.conversationId, deps.clock.now());
  if (!a) return false;
  await deps.repo.finish(a.id, 'cancelled', { by: 'customer' });
  return true;
}
