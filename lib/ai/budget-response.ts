import { NextResponse } from 'next/server';
import { AI_BUDGET_MESSAGE, isAiBudgetError } from './budget';

/**
 * The response for an AI call refused by the monthly budget, or null when the
 * error is something else. Routes put this first in their catch so a person
 * sees a plain reason instead of a generic failure.
 */
export function aiBudgetResponse(err: unknown): NextResponse | null {
  if (!isAiBudgetError(err)) return null;
  return NextResponse.json({ error: AI_BUDGET_MESSAGE, code: 'AI_BUDGET_EXCEEDED' }, { status: 503 });
}
