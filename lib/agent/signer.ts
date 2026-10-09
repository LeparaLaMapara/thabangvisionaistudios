import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Signer } from '@/lib/core/agent/approval';

/**
 * HMAC-SHA256 signer for Ubunye approval tokens. The secret lives only on the
 * server (AGENT_APPROVAL_SECRET, at least 32 characters). Without it, nothing
 * can be approved through Ubunye: booking falls back to the website.
 */
export function approvalSigner(): Signer | null {
  const secret = process.env.AGENT_APPROVAL_SECRET ?? '';
  if (secret.length < 32) return null;
  const mac = (payload: string): Buffer => createHmac('sha256', secret).update(payload).digest();
  return {
    sign: (payload) => mac(payload).toString('base64url'),
    verify: (payload, signature) => {
      let given: Buffer;
      try {
        given = Buffer.from(signature, 'base64url');
      } catch {
        return false;
      }
      const expected = mac(payload);
      return given.length === expected.length && timingSafeEqual(given, expected);
    },
  };
}

export const newActionId = (): string => randomUUID();
export const newNonce = (): string => randomBytes(24).toString('base64url');
export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
