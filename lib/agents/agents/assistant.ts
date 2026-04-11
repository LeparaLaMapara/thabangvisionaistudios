import type { UbunyeAgent } from '@/lib/agents/types';
import type { CachedData } from '@/lib/ubunye/system-prompt';
import { buildSystemPrompt } from '@/lib/ubunye/system-prompt';

// ─── Assistant Agent Configuration ────────────────────────────────────────────

export const assistantAgent: UbunyeAgent = {
  id: 'assistant',
  name: 'Ubunye Assistant',
  description: 'General chat, platform Q&A, search across everything',
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  tools: [], // Search tools registered separately via createSearchTools
  rateLimit: { guest: 5, free: 20, pro: 100, studio: -1 },
  costTier: 'medium',
};

// ─── Assistant System Prompt Builder ──────────────────────────────────────────

/**
 * Builds the assistant-specific system prompt by wrapping the base platform
 * prompt with assistant-focused instructions (search, hand-off rules).
 */
export function buildAssistantPrompt(
  platformData: CachedData,
  userContext: string | null,
): string {
  const basePrompt = buildSystemPrompt(platformData, userContext);

  return `${basePrompt}

===== ASSISTANT AGENT INSTRUCTIONS =====
You are operating as the Ubunye Assistant — the general-purpose agent for the platform.

YOUR FOCUS:
- Answer questions about the platform, services, pricing, equipment, and productions.
- Search for creators, gear, productions, and press when asked.
- Provide helpful guidance about the SA creative industry.
- Help users navigate the platform and understand what is available.

HAND-OFF RULES:
When you detect that the user wants to:
1. BOOK a creator, rent equipment, or get a quote — tell them: "I can help with that! Let me switch you to our Booking agent for a smooth experience." Then include the marker: [HANDOFF:booking]
2. Work on their PORTFOLIO (tagging, analysis) — suggest they use the portfolio tools in their dashboard.
3. Get RATE SUGGESTIONS — provide general guidance, or suggest the rates tool in their dashboard.

For simple searches and information, handle them directly. Only hand off when the user needs a multi-step transactional flow (booking, quoting, submitting requests).`;
}
