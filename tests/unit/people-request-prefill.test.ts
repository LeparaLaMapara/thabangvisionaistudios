import { describe, it, expect } from 'vitest';
import { parseRequestPrefill, prefillQuery } from '@/lib/roles/request-prefill';

const TODAY = '2026-10-17';

describe('request form prefill from a link', () => {
  it('fills the day, the area and the note from a good link', () => {
    expect(parseRequestPrefill({ date: '2026-10-18', area: 'Johannesburg', note: 'Graduation' }, TODAY, { byDays: true })).toEqual({
      dates: ['2026-10-18'],
      area: 'Johannesburg',
      note: 'Graduation',
    });
  });

  it('turns days into that many days in a row, at most 14, only for people priced by the day', () => {
    expect(parseRequestPrefill({ date: '2026-10-30', days: '3' }, TODAY, { byDays: true }).dates).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
    expect(parseRequestPrefill({ date: '2026-10-30', days: '99' }, TODAY, { byDays: true }).dates).toHaveLength(14);
    expect(parseRequestPrefill({ date: '2026-10-30', days: '3' }, TODAY, { byDays: false }).dates).toEqual(['2026-10-30']);
    expect(parseRequestPrefill({ date: '2026-10-30', days: 'lots' }, TODAY, { byDays: true }).dates).toEqual(['2026-10-30']);
  });

  it('drops dates that are past, not real, too far ahead or not dates', () => {
    for (const date of ['2026-10-16', '2026-02-30', '2028-01-01', 'tomorrow', '18/10/2026', '']) {
      expect(parseRequestPrefill({ date }, TODAY, { byDays: true }).dates).toEqual([]);
    }
    expect(parseRequestPrefill({ date: TODAY }, TODAY, { byDays: true }).dates).toEqual([TODAY]);
  });

  it('cleans the text: no tags, no new lines, trimmed to length', () => {
    const p = parseRequestPrefill({ area: '<b>Soweto</b>\n', note: `Graduation\n${'x'.repeat(300)}` }, TODAY, { byDays: true });
    expect(p.area).toBe('b Soweto /b');
    expect(p.note).not.toMatch(/[\n<>]/);
    expect(p.note!.length).toBeLessThanOrEqual(200);
    expect(parseRequestPrefill({ area: '   ' }, TODAY, { byDays: true }).area).toBeNull();
  });

  it('never carries a price: unknown parameters are ignored', () => {
    const p = parseRequestPrefill({ date: '2026-10-18', price: '1', total_cents: '100', amount: '5' } as Record<string, string>, TODAY, { byDays: true });
    expect(Object.keys(p).sort()).toEqual(['area', 'dates', 'note']);
    expect(prefillQuery(p)).toBe('?date=2026-10-18');
  });

  it('the sign-in round trip keeps only the checked values', () => {
    const p = parseRequestPrefill({ date: '2026-10-30', days: '2', area: 'Soweto', note: 'Graduation', evil: 'x' } as Record<string, string>, TODAY, { byDays: true });
    expect(prefillQuery(p)).toBe('?date=2026-10-30&days=2&area=Soweto&note=Graduation');
    expect(prefillQuery({ dates: [], area: null, note: null })).toBe('');
  });
});
