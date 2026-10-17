import { collectIds } from '@/lib/ubunye/chat-cards';

/**
 * Wraps every tool so the ids it returns are remembered for this request.
 * propose_plan accepts only ids in this set (or stored with earlier messages
 * of the same conversation), so the model cannot point a plan at an id it
 * made up or read somewhere else. The server still checks every id again.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function recordToolRefs<T extends Record<string, any>>(tools: T, seen: Set<string>): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapped: Record<string, any> = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (!tool || typeof tool.execute !== 'function') {
      wrapped[name] = tool;
      continue;
    }
    const execute = tool.execute.bind(tool);
    wrapped[name] = {
      ...tool,
      execute: async (...args: unknown[]) => {
        const out = await execute(...args);
        collectIds(out, seen);
        return out;
      },
    };
  }
  return wrapped as T;
}
