/**
 * The first JSON object in a model's answer. Models sometimes add a second
 * object, a note or a code fence after the answer, so a greedy /\{.*\}/ match
 * (first "{" to last "}") does not parse. This walks each "{" and returns the
 * first balanced object that parses; strings are respected, so a "}" inside a
 * value does not end the object early. Null when there is none.
 */
export function firstJsonObject(text: string): Record<string, unknown> | null {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try {
          const value = JSON.parse(text.slice(start, i + 1)) as unknown;
          if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
        } catch {
          // not JSON from this "{": try the next one
        }
        break;
      }
    }
  }
  return null;
}
