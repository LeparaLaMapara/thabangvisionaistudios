import { describe, expect, it } from 'vitest';
import { answerStart, outlineCard, outlineRowDot, outlineRowNote } from '@/lib/ubunye/outline-card';
import { GENERAL_SHOOT, SHOOT_TYPES } from '@/lib/ubunye/shoot-types';

const outline = {
  kind: 'plan_outline',
  type: { slug: 'traditional-wedding', name: 'Traditional wedding' },
  date: { iso: '2026-11-14', label: 'Saturday 14 November 2026', rule: 'as given' },
  place: 'Soweto',
  parts: [
    { key: 'photographer-videographer', kind: 'person', label: 'Photographer or videographer', state: 'listed', count: 2, in_area: 2, from_price: null, do_by: null, line: 'x', next: null },
    { key: 'makeup-artist', kind: 'person', label: 'Make-up artist', state: 'listed', count: 2, in_area: 1, from_price: null, do_by: null, line: 'x', next: null },
    { key: 'lighting-power', kind: 'gear', label: 'Lights', state: 'available', count: 4, in_area: null, from_price: 'R350 a day', do_by: null, line: 'x', next: null },
    { key: 'drone-pilot', kind: 'person', label: 'Drone pilot', state: 'coming_soon', count: null, in_area: null, from_price: null, do_by: null, line: 'x', next: null },
    { key: 'other:catering', kind: 'other', label: 'Catering', state: 'not_offered', count: null, in_area: null, from_price: null, do_by: null, line: 'x', next: null },
  ],
  questions: ['About how many guests?', 'How many hours should we cover?'],
  warnings: ['Some steps are already late.', 'Second warning.'],
};

describe('outlineCard', () => {
  it('builds the title, the when line and one row per part', () => {
    const card = outlineCard(outline)!;
    expect(card.title).toBe('Traditional wedding');
    expect(card.when).toBe('Saturday 14 November 2026 · Soweto');
    expect(card.rows.map((r) => [r.label, r.dot, r.note])).toEqual([
      ['Photographer or videographer', 'gold', '2 listed in or near Soweto'],
      ['Make-up artist', 'gold', '2 listed, 1 in or near Soweto'],
      ['Lights', 'gold', '4 listed, from R350 a day'],
      ['Drone pilot', 'grey', 'Coming soon'],
      ['Catering', 'grey', 'We do not offer this'],
    ]);
  });

  it('shows at most one warning and the first question', () => {
    const card = outlineCard(outline)!;
    expect(card.warning).toBe('Some steps are already late.');
    expect(card.question).toBe('About how many guests?');
  });

  it('shows only what is known in the when line', () => {
    expect(outlineCard({ ...outline, date: null })!.when).toBe('Soweto');
    expect(outlineCard({ ...outline, place: null })!.when).toBe('Saturday 14 November 2026');
    expect(outlineCard({ ...outline, date: null, place: null })!.when).toBe('');
  });

  it('draws nothing for an unavailable outline, no parts, or another tool', () => {
    expect(outlineCard({ kind: 'plan_outline_unavailable', message: 'x' })).toBeNull();
    expect(outlineCard({ ...outline, parts: [] })).toBeNull();
    expect(outlineCard({ kind: 'people_results' })).toBeNull();
    expect(outlineCard(null)).toBeNull();
  });

  it('never says "available" about anything and never invents a price', () => {
    const card = outlineCard(outline)!;
    for (const row of card.rows) expect(row.note.toLowerCase()).not.toContain('available');
    const notes = card.rows.map((r) => r.note).join(' ');
    expect(notes.match(/R\d[\d\s]*/g)).toEqual(['R350 ']);
  });
});

describe('outlineRowNote', () => {
  it('uses the gear price exactly as the tool gave it', () => {
    expect(outlineRowNote({ state: 'available', count: 3, from_price: 'R3 500 a day' }, null)).toBe('3 listed, from R3 500 a day');
    expect(outlineRowNote({ state: 'available', count: 1, from_price: null }, null)).toBe('1 listed');
  });

  it('counts people without a place, and with nobody near the place', () => {
    expect(outlineRowNote({ state: 'listed', count: 5, in_area: null }, null)).toBe('5 listed');
    expect(outlineRowNote({ state: 'listed', count: 5, in_area: 0 }, 'Polokwane')).toBe('5 listed, none near Polokwane yet');
  });

  it('says the other states plainly', () => {
    expect(outlineRowNote({ state: 'nobody_listed' }, null)).toBe('Nobody listed yet');
    expect(outlineRowNote({ state: 'none_listed' }, null)).toBe('None listed right now');
    expect(outlineRowNote({ state: 'unknown' }, null)).toBe('We could not check this just now');
  });

  it('never prices a person, even if a price slipped in', () => {
    expect(outlineRowNote({ kind: 'person', state: 'listed', count: 2, from_price: 'R1 800 a day' }, null)).toBe('2 listed');
  });
});

describe('outlineRowDot', () => {
  it('is gold only when we have it', () => {
    expect(outlineRowDot('listed')).toBe('gold');
    expect(outlineRowDot('available')).toBe('gold');
    for (const s of ['nobody_listed', 'none_listed', 'coming_soon', 'not_offered', 'unknown']) expect(outlineRowDot(s)).toBe('grey');
  });
});

describe('answerStart', () => {
  it('has a natural answer start for every question the shoot catalogue asks', () => {
    const questions = new Set([...SHOOT_TYPES, GENERAL_SHOOT].flatMap((t) => t.questions.map((q) => q.text)));
    expect(questions.size).toBeGreaterThan(0);
    for (const q of questions) expect(answerStart(q), q).toMatch(/ $/);
  });

  it('is null for a question it does not know', () => {
    expect(answerStart('What is your favourite colour?')).toBeNull();
  });
});
