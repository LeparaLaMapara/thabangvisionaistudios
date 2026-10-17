import { describe, it, expect } from 'vitest';
import { forcedOnFlags } from '@/lib/features';

describe('forcedOnFlags (one deployment only)', () => {
  it('is empty when the variable is not set', () => {
    expect(forcedOnFlags(undefined).size).toBe(0);
    expect(forcedOnFlags('').size).toBe(0);
  });
  it('reads known flags and ignores anything else', () => {
    expect([...forcedOnFlags(' ubunye_projects, not_a_flag ,roles_v1')].sort()).toEqual(['roles_v1', 'ubunye_projects']);
  });
  it('is not set in this environment, so tests see the database flags', () => {
    expect(forcedOnFlags().size).toBe(0);
  });
});
