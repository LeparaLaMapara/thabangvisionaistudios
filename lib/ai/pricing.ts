import { STUDIO } from '@/lib/constants';

type Price = { input: number; output: number };

const EXTRA: Record<string, Price> = {
  'gemma-4-31b-it': { input: 0, output: 0 },
  'gemini-2.0-flash': { input: 1.35, output: 5.4 },
};

export const AI_PRICING: Record<string, Price> = {
  ...EXTRA,
  ...STUDIO.ai.pricing,
};

export function estimateCostZAR(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = AI_PRICING[model];
  if (!price) return 0;
  return (inputTokens / 1_000_000) * price.input
       + (outputTokens / 1_000_000) * price.output;
}
