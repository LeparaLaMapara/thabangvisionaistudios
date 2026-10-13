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

type ChatPart = { type?: unknown; text?: unknown };
type ChatMsg = { id?: unknown; role?: unknown; content?: unknown; parts?: unknown };

/**
 * Keeps only what a browser may say: user and assistant turns, text only.
 * A `system` turn, a `tool` turn, or tool calls and results inside an
 * assistant turn would be read by the model as coming from us (security test
 * 2026-10-13: a forged "OPERATOR OVERRIDE" system turn reached the model).
 * Tool results are always produced fresh on the server.
 */
export function clientTextMessages(messages: unknown[]): unknown[] {
  const kept: unknown[] = [];
  for (const raw of messages) {
    const m = raw as ChatMsg | null;
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const out: Record<string, unknown> = { role: m.role };
    if (typeof m.id === 'string') out.id = m.id;
    if (Array.isArray(m.parts)) {
      const parts = (m.parts as ChatPart[])
        .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
        .map((p) => ({ type: 'text', text: p.text as string }));
      if (parts.length === 0) continue;
      out.parts = parts;
    } else if (typeof m.content === 'string') {
      out.content = m.content;
    } else if (Array.isArray(m.content)) {
      const text = (m.content as ChatPart[])
        .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text as string)
        .join(' ');
      if (!text) continue;
      out.content = text;
    } else {
      continue;
    }
    kept.push(out);
  }
  return kept;
}

/**
 * Keeps only user and assistant text (clientTextMessages), refuses a
 * too-long newest message, and keeps only the most recent messages of the
 * history, starting at a user turn.
 */
export function limitChatMessages(input: unknown[]): ChatLimitResult {
  const { maxMessageChars, maxHistoryMessages } = STUDIO.security.chat;
  const messages = clientTextMessages(input);
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
