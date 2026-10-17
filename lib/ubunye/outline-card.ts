/**
 * The "Your shoot" card in the Ubunye chat, built from a plan_outline tool
 * result (lib/agents/tools/outline.ts). Pure and browser-safe.
 *
 * Every word on a row comes from the tool's own fields: counts, the area and
 * gear prices exactly as given. Nothing is computed, no price is made up, and
 * a person is never called "available" (they are asked with a request).
 */

export type OutlineDot = 'gold' | 'grey';

export interface OutlineRow {
  key: string;
  label: string;
  dot: OutlineDot;
  note: string;
}

export interface OutlineCardData {
  title: string;
  /** "Saturday 14 November 2026 · Soweto", only what is known. Empty when nothing is. */
  when: string;
  rows: OutlineRow[];
  /** At most one warning (too late, short notice). */
  warning: string | null;
  /** The first open question, if any. */
  question: string | null;
}

const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max).trim() : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/** The short muted line under one part, from its fields only. */
export function outlineRowNote(part: {
  kind?: unknown;
  state?: unknown;
  count?: unknown;
  in_area?: unknown;
  from_price?: unknown;
}, place: string | null): string {
  const count = num(part.count);
  const inArea = num(part.in_area);
  const price = str(part.from_price, 60);
  switch (part.state) {
    case 'listed': {
      if (count === null || count === 0) return 'Nobody listed yet';
      if (place && inArea !== null) {
        if (inArea === 0) return `${count} listed, none near ${place} yet`;
        if (inArea === count) return `${count} listed in or near ${place}`;
        return `${count} listed, ${inArea} in or near ${place}`;
      }
      return `${count} listed`;
    }
    case 'available': {
      const listed = count !== null && count > 0 ? `${count} listed` : '';
      const from = price ? `from ${price}` : '';
      return [listed, from].filter(Boolean).join(', ') || 'Listed';
    }
    case 'nobody_listed':
      return 'Nobody listed yet';
    case 'none_listed':
      return 'None listed right now';
    case 'coming_soon':
      return 'Coming soon';
    case 'not_offered':
      return 'We do not offer this';
    default:
      return 'We could not check this just now';
  }
}

/** Gold when we have it (people listed, gear listed), grey for everything else. */
export function outlineRowDot(state: unknown): OutlineDot {
  return state === 'listed' || state === 'available' ? 'gold' : 'grey';
}

/** The card, or null when the result is not an outline with parts. */
export function outlineCard(output: unknown): OutlineCardData | null {
  if (!output || typeof output !== 'object') return null;
  const o = output as Record<string, unknown>;
  if (o.kind !== 'plan_outline') return null;
  const parts = Array.isArray(o.parts) ? o.parts : [];
  const place = str(o.place, 80) || null;
  const rows: OutlineRow[] = [];
  for (const raw of parts.slice(0, 20)) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, unknown>;
    const label = str(p.label, 80);
    if (!label) continue;
    // A count of listed people only means "listed": a zero count is shown as nobody.
    const state = p.state === 'listed' && num(p.count) === 0 ? 'nobody_listed' : p.state;
    rows.push({
      key: str(p.key, 80) || label,
      label,
      dot: outlineRowDot(state),
      note: outlineRowNote({ ...p, state }, place),
    });
  }
  if (rows.length === 0) return null;
  const type = o.type && typeof o.type === 'object' ? (o.type as Record<string, unknown>) : null;
  const date = o.date && typeof o.date === 'object' ? (o.date as Record<string, unknown>) : null;
  const title = str(type?.name, 80) || 'Your shoot';
  const when = [str(date?.label, 60), place ?? ''].filter(Boolean).join(' · ');
  const warnings = Array.isArray(o.warnings) ? o.warnings.map((w) => str(w, 400)).filter(Boolean) : [];
  const questions = Array.isArray(o.questions) ? o.questions.map((q) => str(q, 200)).filter(Boolean) : [];
  return { title, when, rows, warning: warnings[0] ?? null, question: questions[0] ?? null };
}

/**
 * The natural start of an answer to one of the outline's questions (the
 * question texts live in lib/ubunye/shoot-types.ts). The chip puts it in the
 * box so the client only types the rest. Null when there is no good start.
 */
const ANSWER_STARTS: Record<string, string> = {
  'Which day is it?': 'It is on ',
  'Where is it (the area or suburb)?': 'It is in ',
  'About how many guests?': 'We expect about ',
  'How many hours should we cover?': 'We need about ',
  'How many shoot days?': 'We shoot for ',
  'How many locations?': 'There will be ',
  'Photos, video or both?': 'We would like ',
  'About how many products or looks?': 'We have about ',
  'How many people need photos?': 'Photos for about ',
};

export function answerStart(question: string): string | null {
  return ANSWER_STARTS[question.trim()] ?? null;
}
