import { describe, it, expect } from 'vitest';
import { bookingTotal, effectiveUnit, formatRolePrice, groupAlbums, pricedByDays } from '@/lib/roles';

describe('one rate per person', () => {
  it("the person's own unit wins over the role's", () => {
    expect(effectiveUnit('hour', 'day')).toBe('day');
    expect(effectiveUnit('hour', null)).toBe('hour');
    expect(formatRolePrice(effectiveUnit('hour', 'day'), 180000)).toMatch(/^R1.800 a day$/);
  });
});

describe('booking total, like Rentals', () => {
  it('day rate x days', () => {
    expect(pricedByDays('day')).toBe(true);
    const t = bookingTotal('day', 180000, { days: 2 });
    expect(t.totalCents).toBe(360000);
    expect(t.label).toMatch(/x 2 days$/);
    expect(bookingTotal('day', 180000, { days: 1 }).label).toMatch(/x 1 day$/);
  });

  it('hourly rate x hours (rounded to half hours)', () => {
    expect(pricedByDays('hour')).toBe(false);
    expect(bookingTotal('hour', 150000, { hours: 3 }).totalCents).toBe(450000);
    expect(bookingTotal('hour', 150000, { hours: 2.3 }).quantity).toBe(2.5);
  });

  it('a look or a project is the price once; nonsense is bounded', () => {
    expect(bookingTotal('look', 65000, { days: 5 }).totalCents).toBe(65000);
    expect(bookingTotal('day', 180000, { days: 0 }).quantity).toBe(1);
    expect(bookingTotal('day', 180000, { days: 99 }).quantity).toBe(31);
  });
});

describe('albums', () => {
  it('groups work by album in first-seen order; no album goes under Work', () => {
    const items = [
      { id: 1, album: 'Maternity' },
      { id: 2, album: 'Family and events' },
      { id: 3, album: 'Maternity' },
      { id: 4, album: null },
    ];
    const albums = groupAlbums(items);
    expect(albums.map((a) => [a.name, a.items.map((i) => i.id)])).toEqual([
      ['Maternity', [1, 3]],
      ['Family and events', [2]],
      ['Work', [4]],
    ]);
  });
});
