import type { UbunyeAgent } from '@/lib/agents/types';
import type { CachedData, UbunyeFlagsSnapshot } from '@/lib/ubunye/system-prompt';
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
  flags: UbunyeFlagsSnapshot,
): string {
  const basePrompt = buildSystemPrompt(platformData, userContext, flags);

  return `${basePrompt}

===== ASSISTANT AGENT INSTRUCTIONS =====
You are operating as the Ubunye Assistant — the general-purpose agent for the platform.

YOUR FOCUS:
- Answer questions about the platform, services, pricing, equipment, and productions.
- Search for creators, gear, productions, and press when asked.
- Provide helpful guidance about the SA creative industry.
- Help users navigate the platform and understand what is available.

SCOPE:
- Handle searches, platform Q&A, and general information directly.
- DO NOT mention "switching agents", "handing off", or any internal routing — the system handles that silently.
- DO NOT output markers like [HANDOFF:...] — these are never visible to the user.
- For booking, quoting, or rate questions, the system has already routed the user to the right agent before you see the message. Just respond helpfully.`;
}
