/**
 * Prepare → approve → commit for anything Ubunye does that has consequences
 * (spec §8.6, §8.7). Pure: no Supabase, Next.js, AI SDK or crypto imports;
 * signing is a port.
 *
 * The model can only PREPARE: the server works out the quote and stores the
 * proposed action with an expiry. COMMIT happens only when the signed-in
 * person presses Approve, which sends a server-issued token bound to them,
 * the action, the amount, the quote version and the expiry. No model tool
 * commits, so neither a chat message, a tool result nor text inside a
 * listing can approve anything. The token is single-use: committing moves
 * the action out of `prepared` with a compare-and-set.
 */

/**
 * project_create: a Ubunye plan (migration 097); project_update: moving a
 * plan to a new date (098). Both cost nothing and book nothing.
 */
export const AGENT_ACTION_KINDS = ['gear_booking', 'service_booking', 'project_create', 'project_update'] as const;
export type AgentActionKind = (typeof AGENT_ACTION_KINDS)[number];

export const AGENT_ACTION_STATES = ['prepared', 'committing', 'committed', 'failed', 'cancelled', 'superseded'] as const;
export type AgentActionState = (typeof AGENT_ACTION_STATES)[number];

/** How long a prepared quote can be approved. Short: prices and stock move. */
export const APPROVAL_TTL_SECONDS = 15 * 60;

export interface ApprovalClaims {
  /** The prepared action. */
  aid: string;
  /** The person it was prepared for. */
  sub: string;
  kind: AgentActionKind;
  /** Server-calculated total, integer cents. */
  amt: number;
  /** Quote version: re-preparing bumps it, so an older token cannot commit. */
  ver: number;
  /** Expiry, seconds since the epoch. */
  exp: number;
  /** Random, per token; only its hash is stored. */
  nonce: string;
}

export interface Signer {
  /** A MAC over the payload with a server secret (never sent to the model or browser). */
  sign(payload: string): string;
  /** Constant-time comparison of a MAC. */
  verify(payload: string, signature: string): boolean;
}

const b64 = {
  encode(s: string): string {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(s: string): string | null {
    if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
    try {
      const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return null;
    }
  },
};

export function issueApprovalToken(claims: ApprovalClaims, signer: Signer): string {
  const payload = b64.encode(JSON.stringify(claims));
  return `${payload}.${signer.sign(payload)}`;
}

export type TokenCheck =
  | { ok: true; claims: ApprovalClaims }
  | { ok: false; code: 'malformed' | 'bad_signature' | 'expired' | 'wrong_user' };

/** Checks the token itself. The action row is checked by `checkCommit`. */
export function verifyApprovalToken(token: unknown, signer: Signer, p: { userId: string; now: Date }): TokenCheck {
  if (typeof token !== 'string' || token.length > 2048) return { ok: false, code: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, code: 'malformed' };
  const [payload, signature] = parts;
  if (!signer.verify(payload, signature)) return { ok: false, code: 'bad_signature' };
  const json = b64.decode(payload);
  if (json === null) return { ok: false, code: 'malformed' };
  let claims: ApprovalClaims;
  try {
    claims = JSON.parse(json) as ApprovalClaims;
  } catch {
    return { ok: false, code: 'malformed' };
  }
  if (
    typeof claims.aid !== 'string' || typeof claims.sub !== 'string' || typeof claims.nonce !== 'string' ||
    !AGENT_ACTION_KINDS.includes(claims.kind) || !Number.isSafeInteger(claims.amt) || claims.amt < 0 ||
    !Number.isSafeInteger(claims.ver) || !Number.isSafeInteger(claims.exp)
  ) {
    return { ok: false, code: 'malformed' };
  }
  if (claims.sub !== p.userId) return { ok: false, code: 'wrong_user' };
  if (claims.exp * 1000 <= p.now.getTime()) return { ok: false, code: 'expired' };
  return { ok: true, claims };
}

/** What the server stored when the action was prepared. */
export interface StoredAction {
  id: string;
  userId: string;
  kind: AgentActionKind;
  state: AgentActionState;
  amountCents: number;
  quoteVersion: number;
  expiresAt: string;
  nonceHash: string;
}

export type CommitCheck =
  | { ok: true }
  | {
      ok: false;
      code: 'not_found' | 'wrong_user' | 'already_used' | 'superseded' | 'expired' | 'mismatch' | 'price_changed' | 'not_approved';
      message: string;
    };

/**
 * Everything a commit must agree on before anything happens (spec §8.7). The
 * caller still re-runs availability, eligibility and the price on the server,
 * and moves the action out of `prepared` atomically.
 */
export function checkCommit(p: {
  action: StoredAction | null;
  claims: ApprovalClaims;
  userId: string;
  nonceHash: string;
  /** The person pressed Approve on the approval screen (from the request, never from the model). */
  explicitApproval: boolean;
  /** The amount the server calculates now, for the same inputs. */
  currentAmountCents: number;
  now: Date;
}): CommitCheck {
  const a = p.action;
  if (!a) return { ok: false, code: 'not_found', message: 'That proposal no longer exists. Ask Ubunye for a new quote.' };
  if (!p.explicitApproval) return { ok: false, code: 'not_approved', message: 'Approve the booking on the approval screen to continue.' };
  if (a.userId !== p.userId || p.claims.sub !== p.userId) return { ok: false, code: 'wrong_user', message: 'This proposal belongs to someone else.' };
  if (a.state === 'superseded') return { ok: false, code: 'superseded', message: 'A newer quote replaced this one. Approve the latest one.' };
  if (a.state !== 'prepared') return { ok: false, code: 'already_used', message: 'This proposal was already used.' };
  if (new Date(a.expiresAt).getTime() <= p.now.getTime()) return { ok: false, code: 'expired', message: 'This quote expired. Ask Ubunye for a fresh one.' };
  if (a.id !== p.claims.aid || a.kind !== p.claims.kind || a.amountCents !== p.claims.amt || a.quoteVersion !== p.claims.ver || a.nonceHash !== p.nonceHash) {
    return { ok: false, code: 'mismatch', message: 'This approval does not match the proposal.' };
  }
  if (p.currentAmountCents !== a.amountCents) {
    return { ok: false, code: 'price_changed', message: 'The price changed since the quote. Ask Ubunye for a fresh one.' };
  }
  return { ok: true };
}
