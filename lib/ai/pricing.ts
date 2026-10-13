import { STUDIO } from '@/lib/constants';

type Price = { input: number; output: number };

const EXTRA: Record<string, Price> = {
  'gemma-4-31b-it': { input: 0, output: 0 },
  // The open-weight 'gemma' route (lib/ai/registry.ts), free tier on the Gemini API.
  'gemma-4-26b-a4b-it': { input: 0, output: 0 },
  'gemini-3.6-flash': { input: 1.35, output: 5.4 },
};

export const AI_PRICING: Record<string, Price> = {
  ...EXTRA,
  ...STUDIO.ai.pricing,
};

/**
 * Models deliberately priced at zero — self-hosted or free-tier. Anything NOT
 * in this set and NOT in AI_PRICING is unknown, and unknown must never be
 * treated as free (see below).
 */
const KNOWN_FREE = new Set(['gemma-4-31b-it', 'gemma-4-26b-a4b-it']);

/**
 * The most expensive known price, used as the floor for unknown models.
 * Recomputed from the table so it tracks whatever is priced.
 */
function worstCasePrice(): { input: number; output: number } {
  let input = 0;
  let output = 0;
  for (const p of Object.values(AI_PRICING)) {
    if (p.input > input) input = p.input;
    if (p.output > output) output = p.output;
  }
  // Absolute floor, so an empty/misconfigured table still over-estimates.
  return { input: Math.max(input, 60), output: Math.max(output, 240) };
}

export function estimateCostZAR(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  let price = AI_PRICING[model];

  // The dangerous case, and the reason this used to return 0: an unpriced
  // model recorded every call as costing nothing, which blinds the budget
  // ceiling and the alert that both read from these numbers. The safe
  // direction for a SPEND estimate is to over-count, never under-count, so an
  // unknown model is charged at the worst known rate and flagged.
  if (!price) {
    if (KNOWN_FREE.has(model)) return 0;
    console.warn(
      `[ai/pricing] no price for model "${model}"; charging worst-case rate. `
      + `Add it to STUDIO.ai.pricing.`,
    );
    price = worstCasePrice();
  }

  const inTok = Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0;
  const outTok = Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0;
  return (inTok / 1_000_000) * price.input
       + (outTok / 1_000_000) * price.output;
}
