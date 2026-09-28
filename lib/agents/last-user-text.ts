/**
 * The text of the last thing the person typed, from a chat request body.
 *
 * The chat window (AI SDK 6) sends each message as { role, parts: [{ type:
 * 'text', text }] }. The router only read the older `content` field, found
 * nothing, and sent every chat to the general assistant, so the booking tools
 * were never reachable. Both shapes are read here.
 */
type Part = { type?: string; text?: string };
type Msg = { role?: string; content?: unknown; parts?: unknown };

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return (value as Part[])
      .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text as string)
      .join(' ');
  }
  return '';
}

export function lastUserText(body: { messages?: unknown; prompt?: unknown } | null | undefined): string {
  const messages = body?.messages;
  if (Array.isArray(messages)) {
    const last = [...(messages as Msg[])].reverse().find((m) => m?.role === 'user');
    if (last) return (textOf(last.parts) || textOf(last.content)).trim();
  }
  return typeof body?.prompt === 'string' ? body.prompt.trim() : '';
}
