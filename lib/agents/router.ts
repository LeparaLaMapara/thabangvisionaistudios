// ─── Intent Classification for Agent Hand-off ────────────────────────────────
// Classifies user messages to route to the appropriate agent.

export type AgentIntent = 'assistant' | 'booking' | 'portfolios' | 'rates';

/**
 * Booking-related patterns — user wants to book, hire, rent, get a quote.
 */
const BOOKING_PATTERNS = [
  /\b(book|booking|hire|hiring)\b/i,
  /\b(quote|quotation|invoice)\b/i,
  /\b(rent|rental|renting)\b/i,
  /\b(availability|available|when\s+can)\b/i,
  /\b(reserve|reservation)\b/i,
  /\b(deposit|pay|payment)\b/i,
  /\b(submit.*request|request.*creator|request.*booking)\b/i,
  /\b(how\s+much.*(?:cost|charge|rate)|what.*(?:cost|charge|rate))\b/i,
];

/**
 * Portfolio-related patterns — user wants portfolio work, image analysis, tagging.
 */
const PORTFOLIO_PATTERNS = [
  /\b(portfolio|portfolios)\b/i,
  /\b(tag|tagging|auto.?tag)\b/i,
  /\b(photo\s+analysis|scene\s+analysis|image\s+analysis)\b/i,
  /\b(classify|classification)\b/i,
  /\b(skill\s+detect|detect.*skill)\b/i,
];

/**
 * Rates-related patterns — user wants pricing advice, rate suggestions.
 */
const RATES_PATTERNS = [
  /\b(rate\s+suggest|suggest.*rate)\b/i,
  /\b(pricing\s+(?:guide|advice|strategy))\b/i,
  /\b(what\s+should\s+i\s+charge)\b/i,
  /\b(market\s+rate|competitive\s+rate)\b/i,
  /\b(hourly\s+rate\s+(?:for|suggestion))\b/i,
];

/**
 * Classify a user message into the most appropriate agent intent.
 *
 * Priority: booking > portfolios > rates > assistant (default).
 */
export function classifyIntent(message: string): AgentIntent {
  if (BOOKING_PATTERNS.some((p) => p.test(message))) {
    return 'booking';
  }

  if (PORTFOLIO_PATTERNS.some((p) => p.test(message))) {
    return 'portfolios';
  }

  if (RATES_PATTERNS.some((p) => p.test(message))) {
    return 'rates';
  }

  return 'assistant';
}
