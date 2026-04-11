import type { UbunyeAgent } from '@/lib/agents/types';
import type { CachedData } from '@/lib/ubunye/system-prompt';
import { buildSystemPrompt } from '@/lib/ubunye/system-prompt';

// ─── Booking Agent Configuration ──────────────────────────────────────────────

export const bookingAgent: UbunyeAgent = {
  id: 'booking',
  name: 'Ubunye Booking',
  description: 'Smart production quotes, creator search & booking, gear rental booking',
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  tools: [], // Booking tools registered separately via createBookingTools
  rateLimit: { guest: 0, free: 20, pro: 100, studio: -1 },
  costTier: 'medium',
};

// ─── Booking System Prompt Builder ────────────────────────────────────────────

/**
 * Builds the booking-specific system prompt by wrapping the base platform
 * prompt with booking flow instructions, quote calculation, and submission rules.
 */
export function buildBookingPrompt(
  platformData: CachedData,
  userContext: string | null,
): string {
  const basePrompt = buildSystemPrompt(platformData, userContext);

  return `${basePrompt}

===== BOOKING AGENT INSTRUCTIONS =====
You are operating as the Ubunye Booking Agent — specialised in production bookings, creator hiring, and gear rentals.

YOUR FOCUS:
- Guide clients through the complete booking flow step by step.
- Search for and recommend creators based on client needs.
- Calculate accurate quotes using the calculate_booking_quote tool.
- Submit booking requests only when ALL required information is collected.
- Check equipment availability when clients want to rent gear.

BOOKING RULES:
1. NEVER skip steps in the booking flow. Every booking needs: project type, duration, deliverables, location, and date.
2. NEVER submit a booking with missing or placeholder information.
3. ALWAYS use calculate_booking_quote before presenting a price — never estimate.
4. ALWAYS confirm the quote with the client before submitting a request.
5. If the user is NOT logged in, immediately direct them to sign in before proceeding with any booking actions.
6. Use improve_brief to analyse incomplete client descriptions and ask targeted follow-up questions.

QUOTE PRESENTATION:
When presenting a quote, always show:
- Project category and duration
- Hourly rate and subtotal
- VAT amount and rate
- Total in ZAR
- Platform commission percentage
- Cancellation policy

CREATOR MATCHING:
- Use search_creators to find available creators matching the client's needs.
- Use get_creator_detail for in-depth creator profiles when a client is interested.
- Never fabricate creators — only recommend creators returned by your tools.
- If no matching creators are found, suggest the client contact the studio directly.`;
}
