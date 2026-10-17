import type { TextStreamPart, ToolSet } from 'ai';

/**
 * No long dashes in what Ubunye says (owner rule: plain words, no em dashes).
 *
 * The prompt asks for it, but a model forgets, so the stream itself swaps
 * them: "R500–R800" reads "R500 to R800", a dash starting a line becomes a
 * plain list "-", and any other long dash becomes a comma. It runs inside
 * streamText, so the saved reply and the next turn's history are clean too.
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

/**
 * streamText transform. A dash or space at the end of a delta waits for the
 * next one, so " —" + " next" still reads ", next".
 */
export function plainDashesTransform<TOOLS extends ToolSet>() {
  return () => {
    const carry = new Map<string, string>();
    const last = new Map<string, string>();
    const emit = (id: string, text: string, ctl: TransformStreamDefaultController<TextStreamPart<TOOLS>>) => {
      const fixed = plainDashes(text, last.get(id) ?? '');
      if (!fixed) return;
      last.set(id, fixed.slice(-1));
      ctl.enqueue({ type: 'text-delta', id, text: fixed } as TextStreamPart<TOOLS>);
    };
    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(part, ctl) {
        if (part.type === 'text-delta') {
          const text = (carry.get(part.id) ?? '') + part.text;
          const tail = /[\s—–]*$/.exec(text)?.[0] ?? '';
          carry.set(part.id, tail);
          const head = text.slice(0, text.length - tail.length);
          if (head) emit(part.id, head, ctl);
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
