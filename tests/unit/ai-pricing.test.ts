import { describe, it, expect } from 'vitest';
import { estimateCostZAR, AI_PRICING } from '@/lib/ai/pricing';

describe('estimateCostZAR', () => {
  it('returns 0 for an unknown model', () => {
    expect(estimateCostZAR('nonexistent-model', 1_000_000, 1_000_000)).toBe(0);
  });

  it('returns 0 when token counts are zero', () => {
    const anyKnown = Object.keys(AI_PRICING)[0];
    expect(estimateCostZAR(anyKnown, 0, 0)).toBe(0);
  });

  it('prices claude sonnet at R54/R216 per 1M tokens', () => {
    const model = 'claude-sonnet-4-20250514';
    expect(AI_PRICING[model]).toEqual({ input: 54, output: 216 });
    expect(estimateCostZAR(model, 1_000_000, 1_000_000)).toBeCloseTo(270, 5);
  });

  it('scales linearly with token counts', () => {
    const model = 'gemini-2.0-flash';
    const half = estimateCostZAR(model, 500_000, 500_000);
    const whole = estimateCostZAR(model, 1_000_000, 1_000_000);
    expect(whole).toBeCloseTo(half * 2, 5);
  });

  it('prices gemma vision at zero (free tier)', () => {
    expect(estimateCostZAR('gemma-4-31b-it', 1_000_000, 1_000_000)).toBe(0);
  });
});
