/**
 * Words on the approval card for a proposal that costs nothing (a plan, a
 * plan move, asking people). Pure and browser-safe.
 *
 * The card shows the server's own title; the gold button names what pressing
 * it does. The kind comes from the server when it says so (the summary or
 * the proposal), else from the tool that prepared it in the chat.
 */

export type NoChargeKind = 'project_create' | 'project_update' | 'people_requests';

const KINDS: readonly NoChargeKind[] = ['project_create', 'project_update', 'people_requests'];

const asKind = (v: unknown): NoChargeKind | null => (KINDS.includes(v as NoChargeKind) ? (v as NoChargeKind) : null);

/** The tools that prepare each kind today. */
const TOOL_KINDS: Record<string, NoChargeKind> = {
  propose_plan: 'project_create',
  propose_plan_move: 'project_update',
};

/**
 * The proposal's kind from the tool that made it: the output's own `kind` or
 * `action_kind` when it is one we know, else the tool's name. Null when unknown.
 */
export function proposalKind(tool: string, output: unknown): NoChargeKind | null {
  const o = output && typeof output === 'object' ? (output as Record<string, unknown>) : {};
  const said = asKind(o.action_kind) ?? asKind(o.kind);
  if (said) return said;
  if (TOOL_KINDS[tool]) return TOOL_KINDS[tool];
  if (/people/.test(tool) && /propose|request|ask/.test(tool)) return 'people_requests';
  return null;
}

/** The first kind we know among the given sources (server first, then the chat). */
export function pickKind(...sources: unknown[]): NoChargeKind | null {
  for (const s of sources) {
    const k = asKind(s);
    if (k) return k;
  }
  return null;
}

/** The gold button, before and while it works. Unknown kinds keep the card's long-standing "Save plan". */
export function noChargeButton(kind: NoChargeKind | null): { label: string; working: string } {
  switch (kind) {
    case 'project_update':
      return { label: 'Move plan', working: 'Moving…' };
    case 'people_requests':
      return { label: 'Ask them', working: 'Sending…' };
    case 'project_create':
    default:
      return { label: 'Save plan', working: 'Saving…' };
  }
}

/** What the card says after "Not now". */
export function noChargeDeclined(kind: NoChargeKind | null): string {
  switch (kind) {
    case 'project_update':
      return 'Not moved. Nothing was booked or charged.';
    case 'people_requests':
      return 'Not sent. Nothing was booked or charged.';
    default:
      return 'Not saved. Nothing was booked or charged.';
  }
}
