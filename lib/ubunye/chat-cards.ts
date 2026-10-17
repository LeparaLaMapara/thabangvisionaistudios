/**
 * Chat cards that survive a reload. Pure and browser-safe.
 *
 * The chat draws cards from tool results: People results (find_people) and
 * approval cards (any proposal: gear, plan). Before, only the reply text was
 * kept, so a reload lost every card. Now the server stores a blind copy of
 * each card with the logged assistant message (chat_messages.cards, 097) and
 * the browser keeps the same copy in its session; both rebuild the same tool
 * parts on load.
 *
 * Blind People rule: a People card is rebuilt field by field from an allow
 * list (the same fields find_people sends), so nothing else can ride along.
 * A proposal card is only its id: the card itself loads the server's summary.
 */

export const CARD_TOOL_PEOPLE = 'find_people';
export const CARD_TOOL_PROPOSAL = 'propose_plan';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max = 400): string => (typeof v === 'string' ? v.slice(0, max) : '');
const ownPath = (v: unknown): string | null => (typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') ? v.slice(0, 400) : null);
const waLink = (v: unknown): string | null => (typeof v === 'string' && v.startsWith('https://wa.me/') ? v.slice(0, 1200) : null);

export type ChatCard =
  | { type: 'people'; output: Record<string, unknown> }
  | { type: 'proposal'; proposal_id: string };

function blindMatch(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const id = str(m.id, 40);
  if (!UUID.test(id)) return null;
  const request = ownPath(m.request_url);
  if (!request || !request.startsWith(`/people/${id}/request`)) return null;
  const cover = str(m.cover_url, 600);
  return {
    id,
    role: str(m.role, 80),
    area: str(m.area, 80),
    area_fit: str(m.area_fit, 160),
    profile_url: `/people/${id}`,
    request_url: request,
    price: str(m.price, 80),
    total: str(m.total, 40),
    total_cents: Number.isSafeInteger(m.total_cents) ? m.total_cents : null,
    total_label: str(m.total_label, 120),
    cover_url: cover && (cover.startsWith('https://') || ownPath(cover)) ? cover : null,
    work_count: Number.isSafeInteger(m.work_count) ? m.work_count : 0,
    verified: m.verified === true,
    record: str(m.record, 80),
    usual_days_note: str(m.usual_days_note, 300) || null,
    budget_note: str(m.budget_note, 200) || null,
  };
}

/** A find_people output, rebuilt from the allow list. Null for anything else. */
export function blindPeopleOutput(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.kind === 'people_unavailable') {
    return { kind: 'people_unavailable', status: str(o.status, 40), message: str(o.message, 400), whatsapp_url: waLink(o.whatsapp_url), browse_url: ownPath(o.browse_url) };
  }
  if (o.kind !== 'people_results') return null;
  const date = o.date && typeof o.date === 'object' ? (o.date as Record<string, unknown>) : null;
  const short = o.short_notice && typeof o.short_notice === 'object' ? (o.short_notice as Record<string, unknown>) : null;
  return {
    kind: 'people_results',
    status: str(o.status, 40),
    role: o.role && typeof o.role === 'object' ? { slug: str((o.role as Record<string, unknown>).slug, 40), name: str((o.role as Record<string, unknown>).name, 80) } : null,
    date: date ? { iso: str(date.iso, 10), label: str(date.label, 60) } : null,
    matches: (Array.isArray(o.matches) ? o.matches : []).slice(0, 5).map(blindMatch).filter((m): m is Record<string, unknown> => m !== null),
    availability: str(o.availability, 400),
    short_notice: short ? { message: str(short.message, 400), whatsapp_url: waLink(short.whatsapp_url) } : null,
    browse_url: ownPath(o.browse_url) ?? '/people',
    whatsapp_url: waLink(o.whatsapp_url),
  };
}

/** A card from one tool result, or null when the result draws no card. */
export function cardFromToolResult(toolName: string, output: unknown): ChatCard | null {
  if (toolName === CARD_TOOL_PEOPLE) {
    const people = blindPeopleOutput(output);
    return people ? { type: 'people', output: people } : null;
  }
  const o = output as { approval_required?: unknown; proposal_id?: unknown } | null;
  if (o && o.approval_required === true && typeof o.proposal_id === 'string' && UUID.test(o.proposal_id)) {
    return { type: 'proposal', proposal_id: o.proposal_id };
  }
  return null;
}

/** Cards from the AI SDK's finished steps (server, onFinish). */
export function cardsFromSteps(steps: unknown): ChatCard[] {
  const out: ChatCard[] = [];
  for (const step of Array.isArray(steps) ? steps : []) {
    const results = (step as { toolResults?: unknown }).toolResults;
    for (const r of Array.isArray(results) ? results : []) {
      const tr = r as { toolName?: unknown; output?: unknown };
      if (typeof tr.toolName !== 'string') continue;
      const card = cardFromToolResult(tr.toolName, tr.output);
      if (card) out.push(card);
    }
  }
  return out.slice(0, 8);
}

/** Cards from a message's UI parts (browser, before keeping the chat in the session). */
export function cardsFromUiParts(parts: unknown): ChatCard[] {
  const out: ChatCard[] = [];
  for (const p of Array.isArray(parts) ? parts : []) {
    const part = p as { type?: unknown; state?: unknown; output?: unknown };
    if (typeof part.type !== 'string' || !part.type.startsWith('tool-') || part.state !== 'output-available') continue;
    const card = cardFromToolResult(part.type.slice('tool-'.length), part.output);
    if (card) out.push(card);
  }
  return out.slice(0, 8);
}

/** Stored cards, checked again (they come back from the database or the session). */
export function readCards(raw: unknown): ChatCard[] {
  const out: ChatCard[] = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    const card = c as { type?: unknown; output?: unknown; proposal_id?: unknown };
    if (card.type === 'people') {
      const people = blindPeopleOutput(card.output);
      if (people) out.push({ type: 'people', output: people });
    } else if (card.type === 'proposal' && typeof card.proposal_id === 'string' && UUID.test(card.proposal_id)) {
      out.push({ type: 'proposal', proposal_id: card.proposal_id });
    }
  }
  return out.slice(0, 8);
}

/** Tool parts the chat list draws, rebuilt from cards. */
export function cardsToUiParts(cards: readonly ChatCard[], messageId: string): Record<string, unknown>[] {
  return cards.map((c, i) =>
    c.type === 'people'
      ? { type: `tool-${CARD_TOOL_PEOPLE}`, toolCallId: `${messageId}-card-${i}`, state: 'output-available', input: {}, output: c.output }
      : { type: `tool-${CARD_TOOL_PROPOSAL}`, toolCallId: `${messageId}-card-${i}`, state: 'output-available', input: {}, output: { approval_required: true, proposal_id: c.proposal_id } },
  );
}

/**
 * Every id-shaped value in a tool result (field values, not text inside
 * links), so a later plan may only point at ids a tool really returned.
 */
export function collectIds(value: unknown, into: Set<string>, depth = 0): Set<string> {
  if (depth > 6 || value === null || value === undefined) return into;
  if (typeof value === 'string') {
    if (UUID.test(value)) into.add(value.toLowerCase());
    return into;
  }
  if (Array.isArray(value)) {
    for (const v of value.slice(0, 50)) collectIds(v, into, depth + 1);
    return into;
  }
  if (typeof value === 'object') for (const v of Object.values(value as Record<string, unknown>)) collectIds(v, into, depth + 1);
  return into;
}
