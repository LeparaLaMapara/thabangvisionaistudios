/**
 * Phase 6 security LLM-1: the Ubunye system prompt carried the bank account
 * and branch numbers (CLAUDE.md: never include bank details in AI prompts).
 * A hijacked model could echo them, or "new" ones; the prompt now points to
 * /pay instead.
 */
import { describe, expect, it } from 'vitest';
import { STUDIO } from '@/lib/constants';
import { buildSystemPrompt, type CachedData } from '@/lib/ubunye/system-prompt';

const empty: CachedData = { rentals: '', productions: null, press: '', careers: '', creators: '', listings: '', plans: '', services: '', crew: '' };

describe('Ubunye system prompt carries no bank details (LLM-1)', () => {
  for (const smart_productions of [false, true]) {
    it(`smart_productions=${smart_productions}`, () => {
      const prompt = buildSystemPrompt(empty, 'Signed in as a test user.', { smart_productions });
      expect(prompt).not.toContain(STUDIO.bank.accountNumber);
      expect(prompt).not.toContain(STUDIO.bank.branchCode);
      expect(prompt).toContain(`${STUDIO.meta.url}/pay`);
    });
  }
});
