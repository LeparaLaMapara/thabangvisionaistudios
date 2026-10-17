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

import { peopleListed } from '@/lib/ai/plain-dashes';

describe('peopleListed (a person is listed, never available)', () => {
  it('changes the words for people', () => {
    expect(peopleListed('We found 2 photographers available in Soweto.')).toBe('We found 2 photographers listed in Soweto.');
    expect(peopleListed('2 make-up artists are available.')).toBe('2 make-up artists are listed.');
    expect(peopleListed('### Photographers Available')).toBe('### Photographers Listed');
    expect(peopleListed('Here are the available creators.')).toBe('Here are the listed creators.');
    expect(peopleListed('2 photographers or videographers available')).toBe('2 photographers or videographers listed');
  });
  it('leaves gear and other uses alone', () => {
    expect(peopleListed('The Aputure 600d is available for rental.')).toBe('The Aputure 600d is available for rental.');
    expect(peopleListed('Lights: 2 available, from R120 a day.')).toBe('Lights: 2 available, from R120 a day.');
    expect(peopleListed('Here is what is available on the platform.')).toBe('Here is what is available on the platform.');
  });
});

describe('plainDashesTransform, people words', () => {
  it('fixes "available" split across deltas', async () => {
    expect(await run(['We found 2 photographers ', 'avail', 'able near you. Pick one.'])).toBe('We found 2 photographers listed near you. Pick one.');
  });
});
