/**
 * Job requirements are pasted into /admin as lines. Some arrived with their
 * own bullet ("- 5+ years", shown as "— - 5+ years") and some sentences were
 * split across two lines ("commercial, corporate, or" / "narrative shoots").
 * This tidies the display: strips a leading bullet and joins a line that
 * clearly continues the one before it. The stored rows are not changed.
 */
export function cleanRequirements(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/^\s*(?:[-*•–—]\s*)+/, '').trim();
    if (!line) continue;
    const prev = out[out.length - 1];
    const continues = prev !== undefined && !/[.!?:;)]$/.test(prev) && /^[a-z(]/.test(line);
    if (continues) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out;
}
