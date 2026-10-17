import { describe, it, expect } from 'vitest';
import type { TextStreamPart, ToolSet } from 'ai';
import { plainDashes, plainDashesTransform } from '@/lib/ai/plain-dashes';

describe('plainDashes', () => {
  it('turns a long dash between words into a comma', () => {
    expect(plainDashes('Make-up — coming soon')).toBe('Make-up, coming soon');
    expect(plainDashes('Photos—and video')).toBe('Photos, and video');
  });
  it('reads a number range as "to"', () => {
    expect(plainDashes('R500–R800 a day')).toBe('R500 to R800 a day');
    expect(plainDashes('3 – 4 weeks')).toBe('3 to 4 weeks');
  });
  it('makes a dash at the start of a line a plain list dash', () => {
    expect(plainDashes('Parts:\n— Photographer\n— Make-up')).toBe('Parts:\n- Photographer\n- Make-up');
  });
  it('leaves hyphens and clean text alone', () => {
    expect(plainDashes('make-up on 14-11, R1 300 a day')).toBe('make-up on 14-11, R1 300 a day');
  });
  it('never leaves a comma before a full stop', () => {
    expect(plainDashes('Booked —.')).toBe('Booked.');
  });
});

async function run(deltas: string[]): Promise<string> {
  const parts: TextStreamPart<ToolSet>[] = [
    { type: 'text-start', id: 't' } as TextStreamPart<ToolSet>,
    ...deltas.map((text) => ({ type: 'text-delta', id: 't', text }) as TextStreamPart<ToolSet>),
    { type: 'text-end', id: 't' } as TextStreamPart<ToolSet>,
  ];
  const out = new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(p)); c.close(); } })
    .pipeThrough(plainDashesTransform<ToolSet>()());
  let text = '';
  for await (const p of out as unknown as AsyncIterable<TextStreamPart<ToolSet>>) if (p.type === 'text-delta') text += p.text;
  return text;
}

describe('plainDashesTransform', () => {
  it('fixes a dash split across deltas', async () => {
    expect(await run(['Photographer ', '—', ' listed in Soweto.'])).toBe('Photographer, listed in Soweto.');
  });
  it('fixes a range split across deltas', async () => {
    expect(await run(['R500', '–', 'R800'])).toBe('R500 to R800');
  });
  it('passes clean text through unchanged', async () => {
    expect(await run(['Hello ', 'there. ', 'Two people listed.'])).toBe('Hello there. Two people listed.');
  });
});
