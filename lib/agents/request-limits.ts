import { STUDIO } from '@/lib/constants';
import { lastUserText } from '@/lib/agents/last-user-text';

/**
 * Cost limits for one Ubunye chat request (Phase 6 security LLM-4 / LLM-5).
 * Before: a 2 MB message was accepted and sent to the model, output tokens
 * were uncapped, and stepCountIs(4) bounded round trips but not tool calls
 * (20 calls per step -> 80 tool executions for one message).
 * Values: STUDIO.security.chat.
 */

export type ChatLimitResult =
  | { ok: true; messages: unknown[] }
  | { ok: false; status: 400 | 413; error: string };

/** True when a request body of this many bytes may be read. */
export function chatBodyWithinLimit(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes <= STUDIO.security.chat.maxBodyBytes;
}

export const CHAT_TOO_LONG_MESSAGE = 'That message is too long. Please shorten it, or start a new chat.';

/**
 * Refuses a too-long newest message and keeps only the most recent
 * messages of the history, starting at a user turn.
 */
export function limitChatMessages(messages: unknown[]): ChatLimitResult {
  const { maxMessageChars, maxHistoryMessages } = STUDIO.security.chat;
  if (lastUserText({ messages }).length > maxMessageChars) {
    return { ok: false, status: 413, error: CHAT_TOO_LONG_MESSAGE };
  }
  let kept = messages.length > maxHistoryMessages ? messages.slice(-maxHistoryMessages) : messages;
  const firstUser = kept.findIndex((m) => (m as { role?: unknown } | null)?.role === 'user');
  if (firstUser > 0) kept = kept.slice(firstUser);
  if (kept.length === 0) return { ok: false, status: 400, error: '`messages` must include a user message.' };
  return { ok: true, messages: kept };
}

export const TOOL_LIMIT_RESULT = {
  error: 'Tool call limit reached for this message. Answer with what you already have, or ask the person to narrow the request.',
};

/**
 * Wraps every tool's execute with one shared counter for the request: after
 * `max` executions, further calls return TOOL_LIMIT_RESULT without running.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function capToolCalls<T extends Record<string, any>>(tools: T, max: number = STUDIO.security.chat.maxToolCallsPerMessage): T {
  let used = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const capped: Record<string, any> = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (!tool || typeof tool.execute !== 'function') {
      capped[name] = tool;
      continue;
    }
    const execute = tool.execute.bind(tool);
    capped[name] = {
      ...tool,
      execute: async (...args: unknown[]) => {
        used += 1;
        if (used > max) return TOOL_LIMIT_RESULT;
        return execute(...args);
      },
    };
  }
  return capped as T;
}
