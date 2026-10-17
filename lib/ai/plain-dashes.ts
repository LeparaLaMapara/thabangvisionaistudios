import type { TextStreamPart, ToolSet } from 'ai';

/**
 * Owner rules that a model forgets, enforced on the stream itself:
 *
 * - No long dashes (plain words): "R500–R800" reads "R500 to R800", a dash
 *   starting a line becomes a plain list "-", any other long dash a comma.
 * - People have no calendar, so a person is never "available" (they are
 *   "listed" and need confirmation). Gear may be available; only the words
 *   for people are changed.
 *
 * It runs inside streamText, so the saved reply and the next turn's history
 * are clean too.
 */

const LONG = /[—–]/;

/** Swaps long dashes in one piece of text. `before` is the character just ahead of it (for "5–7"). */
export function plainDashes(text: string, before = ''): string {
  if (!LONG.test(text)) return text;
  const out = (before + text)
    .replace(/(\d)[ \t]*[—–][ \t]*(?=R?\d)/g, '$1 to ')
    .replace(/(^|\n)([ \t]*)[—–][ \t]*/g, '$1$2- ')
    .replace(/[ \t]*[—–]+[ \t]*/g, ', ')
    .replace(/,[ \t]*,/g, ',')
    .replace(/,[ \t]*([.!?:;])/g, '$1');
  return out.slice(before.length);
}

const PERSON =
  '(?:photographers?|videographers?|photographers? or videographers?|make-?up artists?|hair ?stylists?|stylists?|models?|drivers?|editors?|creators?|people|persons?|crew|pilots?|assistants?|artists?)';
const PERSON_AVAILABLE = new RegExp(`\\b(${PERSON})(\\s+(?:are|is)\\s+|\\s+)(available)\\b`, 'gi');
const AVAILABLE_PERSON = new RegExp(`\\b(available)(\\s+)(${PERSON})\\b`, 'gi');

const keepCase = (word: string, like: string) => (like[0] === like[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word);

/** "2 photographers are available" -> "2 photographers are listed"; "available creators" -> "listed creators". */
export function peopleListed(text: string): string {
  if (!/available/i.test(text)) return text;
  return text
    .replace(PERSON_AVAILABLE, (_m, who: string, gap: string, word: string) => `${who}${gap}${keepCase('listed', word)}`)
    .replace(AVAILABLE_PERSON, (_m, word: string, gap: string, who: string) => `${keepCase('listed', word)}${gap}${who}`);
}

/** Both rules on one piece of text. */
export function plainWords(text: string, before = ''): string {
  return peopleListed(plainDashes(text, before));
}

/** Where a delta may be cut: after the last sentence end or line break. */
function cutPoint(text: string): number {
  const m = /[\s\S]*[.!?:\n][\s"')\]*_]*/.exec(text);
  if (m) return m[0].length;
  // A long run with no sentence end: release all but the last few words.
  if (text.length > 300) return text.length - 40;
  return 0;
}

/**
 * streamText transform. Text is released a sentence (or line) at a time, so a
 * phrase split across deltas ("photographers " + "available") is still seen
 * whole; whatever is left is released at the end of the text.
 */
export function plainDashesTransform<TOOLS extends ToolSet>() {
  return () => {
    const carry = new Map<string, string>();
    const last = new Map<string, string>();
    const emit = (id: string, text: string, ctl: TransformStreamDefaultController<TextStreamPart<TOOLS>>) => {
      const fixed = plainWords(text, last.get(id) ?? '');
      if (!fixed) return;
      last.set(id, fixed.slice(-1));
      ctl.enqueue({ type: 'text-delta', id, text: fixed } as TextStreamPart<TOOLS>);
    };
    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(part, ctl) {
        if (part.type === 'text-delta') {
          const text = (carry.get(part.id) ?? '') + part.text;
          const cut = cutPoint(text);
          carry.set(part.id, text.slice(cut));
          if (cut > 0) emit(part.id, text.slice(0, cut), ctl);
          return;
        }
        if (part.type === 'text-end') {
          const rest = carry.get(part.id);
          carry.delete(part.id);
          if (rest) emit(part.id, rest, ctl);
          last.delete(part.id);
        }
        ctl.enqueue(part);
      },
      flush(ctl) {
        for (const [id, rest] of carry) if (rest) emit(id, rest, ctl);
        carry.clear();
      },
    });
  };
}
