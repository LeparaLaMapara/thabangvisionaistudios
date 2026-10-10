/**
 * Phase 6 security INJ-7: terms spliced into PostgREST or=() filter strings
 * were only LIKE-escaped, so a comma in a chat/agent search term added extra
 * OR conditions (e.g. `x%,is_published.eq.false,title.ilike.%`).
 */
import { describe, expect, it } from 'vitest';
import { filterIlikePattern, sanitizeFilterTerm } from '@/lib/search/types';
import { createSearchTools } from '@/lib/agents/tools/search';

const INJECTION = 'canon%,is_published.eq.false,title.ilike.%';

/** Split an or=() string the way PostgREST does at top level (no quoting used here). */
const conditions = (or: string): string[] => or.split(',');

describe('sanitizeFilterTerm / filterIlikePattern', () => {
  it('removes every PostgREST metacharacter', () => {
    const t = sanitizeFilterTerm('a,b.c(d)e"f\'g*h\\i:j\nk');
    expect(t).not.toMatch(/[,.()"'*\\:\n]/);
    expect(t).toBe('a b c d e f g h i j k');
  });
  it('keeps ordinary search words and LIKE-escapes what is left', () => {
    expect(filterIlikePattern('Sony A7 III')).toBe('%Sony A7 III%');
    expect(filterIlikePattern('100%_off')).toBe('%100\\%\\_off%');
  });
  it('nothing left -> null; non-strings -> null; long input capped', () => {
    expect(filterIlikePattern(',.()')).toBeNull();
    expect(filterIlikePattern(42)).toBeNull();
    expect(sanitizeFilterTerm('x'.repeat(500))).toHaveLength(100);
  });
});

describe('agent search tools build a fixed number of OR conditions (INJ-7)', () => {
  function fakeSupabase(seen: string[]) {
    const q = {
      select: () => q, eq: () => q, is: () => q, order: () => q, limit: () => q, lte: () => q, ilike: () => q, in: () => q, not: () => q,
      or: (s: string) => { seen.push(s); return q; },
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
    };
    return { from: () => q };
  }

  it.each([
    ['search_gear', 3],
    ['search_productions', 3],
    ['search_press', 2],
  ])('%s', async (tool, expected) => {
    const seen: string[] = [];
    const tools = createSearchTools(fakeSupabase(seen), { smart_productions: true });
    await tools[tool].execute({ search_term: INJECTION });
    expect(seen).toHaveLength(1);
    expect(conditions(seen[0])).toHaveLength(expected);
    expect(seen[0]).not.toContain('is_published');
  });
});
