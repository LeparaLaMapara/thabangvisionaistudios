import { describe, it, expect } from 'vitest';

/**
 * Guard: unit tests must never run against production credentials.
 *
 * The production Supabase project ref and live payment keys are listed here
 * only so the test can refuse them. If any of these appear in the test
 * environment, the suite fails before a test can touch real data or money.
 */
const PROD_SUPABASE_REF = 'zbdsqvpxpsygbuqnuekm';

describe('test environment uses no production credentials', () => {
  it('does not point at the production Supabase project', () => {
    for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL']) {
      expect(process.env[key] ?? '').not.toContain(PROD_SUPABASE_REF);
    }
  });

  it('does not carry live payment keys', () => {
    const liveKeyPattern = /^(sk|pk)_live_/;
    for (const key of ['PAYSTACK_SECRET_KEY', 'NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY', 'YOCO_SECRET_KEY']) {
      expect(process.env[key] ?? '').not.toMatch(liveKeyPattern);
    }
  });
});
