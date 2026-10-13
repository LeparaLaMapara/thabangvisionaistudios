import { describe, it, expect } from 'vitest';
import { withoutUnverifiedPortfolio } from '@/lib/supabase/queries/profiles';

describe('an unverified creator\'s portfolio is never returned publicly', () => {
  it('keeps a verified creator\'s portfolio', () => {
    const p = { id: 'a', verification_status: 'verified', portfolio_projects: [{ title: 'x' }] };
    expect(withoutUnverifiedPortfolio(p).portfolio_projects).toEqual([{ title: 'x' }]);
  });
  it.each(['pending', 'rejected', 'unverified', null])('hides it when the check is %s', (status) => {
    const p = { id: 'b', verification_status: status, portfolio_projects: [{ title: 'y' }] };
    expect(withoutUnverifiedPortfolio(p)).toMatchObject({ id: 'b', portfolio_projects: null });
  });
});
