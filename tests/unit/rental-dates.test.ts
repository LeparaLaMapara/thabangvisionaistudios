import { describe, it, expect } from 'vitest';
import { toLocalYmd, fromLocalYmd } from '@/lib/rental/dates';

describe('rental dates are the days the person picked', () => {
  it('formats local midnight as that local day, not the UTC day before', () => {
    // Local midnight on 3 October. In Johannesburg toISOString() gave 2 October.
    expect(toLocalYmd(new Date(2026, 9, 3))).toBe('2026-10-03');
    expect(toLocalYmd(new Date(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01');
  });

  it('reads a date from the address back to the same day', () => {
    const d = fromLocalYmd('2026-10-03')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 3]);
    expect(toLocalYmd(d)).toBe('2026-10-03');
  });

  it('ignores anything that is not a real date', () => {
    for (const bad of [null, '', '2026-13-01', '2026-02-30', 'tomorrow', '2026-1-3']) {
      expect(fromLocalYmd(bad as string | null)).toBeNull();
    }
  });
});
