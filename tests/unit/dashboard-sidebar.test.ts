import { describe, it, expect } from 'vitest';
import { sidebarGroups } from '@/components/dashboard/DashboardSidebar';

const titles = (isCreator: boolean, isVerified: boolean) => sidebarGroups(isCreator, isVerified).map((g) => g.title);
const accountLabels = (isCreator: boolean, isVerified: boolean) =>
  sidebarGroups(isCreator, isVerified).find((g) => g.title === 'Account')!.items.map((i) => i.label);

describe('DashboardSidebar groups', () => {
  it('shows exactly one Account group to everyone', () => {
    for (const [c, v] of [[false, false], [false, true], [true, true]] as const) {
      expect(titles(c, v).filter((t) => t === 'Account')).toHaveLength(1);
    }
  });

  it('a renter who is not verified: no studio tools, no payouts, a way to get verified', () => {
    expect(titles(false, false)).toEqual(['Activity', 'Account']);
    expect(accountLabels(false, false)).toEqual(['Profile', 'Notifications', 'Get Verified']);
  });

  it('a verified renter: no studio tools, no "Get Verified", a way in to offering gear', () => {
    expect(titles(false, true)).toEqual(['Activity', 'Account']);
    expect(accountLabels(false, true)).toEqual(['Profile', 'Notifications', 'Offer gear or services']);
  });

  it('a creator: studio tools and payouts', () => {
    expect(titles(true, true)).toEqual(['Activity', 'Studio', 'Account']);
    expect(accountLabels(true, true)).toEqual(['Profile', 'Payouts', 'Notifications']);
  });
});
