import { describe, it, expect } from 'vitest';
import { CREATOR_JOIN, EARN, RENTAL_POLICY, STUDIO } from '@/lib/constants';
import { earnContent } from '@/lib/content/earn';
import { footerSectionsSync } from '@/lib/nav';

const live = [
  { slug: 'photographer-videographer', name: 'Photographer or videographer' },
  { slug: 'makeup-artist', name: 'Make-up artist' },
];

describe('Earn: a public page that says only what the money code does', () => {
  it('commission is the service booking commission, before VAT', () => {
    const c = earnContent({ rolesOn: true, liveRoles: live });
    expect(STUDIO.booking.platformCommission).toBe(15);
    expect(c.keeps[0]).toContain('we keep 15% of the booking price before VAT');
  });

  it('gear share and payout timing come from RENTAL_POLICY and STUDIO.booking', () => {
    const c = earnContent({ rolesOn: false, liveRoles: [] }).paid.join(' ') + earnContent({ rolesOn: false, liveRoles: [] }).keeps.join(' ');
    expect(c).toContain(`you get ${RENTAL_POLICY.ownerShareBps / 100}% of the hire fee`);
    expect(c).toContain(`${STUDIO.booking.payoutDelayHours} hours after the client approves`);
    expect(c).toContain(`${RENTAL_POLICY.ownerPayoutDelayHours} hours after the gear comes back`);
  });

  it('names the live roles with the flag on, and the sign-up button starts Offer', () => {
    const c = earnContent({ rolesOn: true, liveRoles: live });
    expect(c.who[0]).toContain('photographers and videographers and make-up artists');
    expect(c.cta.href).toBe('/offer');
  });

  it('flag off: creator setup, no roles promised', () => {
    const c = earnContent({ rolesOn: false, liveRoles: live });
    expect(c.cta.href).toBe(CREATOR_JOIN.href);
    expect(c.who[0]).not.toContain('make-up');
  });

  it('every Earn link points to the public page', () => {
    expect(EARN.href).toBe('/earn');
    for (const on of [true, false]) {
      const earn = footerSectionsSync(on).flatMap((s) => s.links).filter((l) => /^Earn with /.test(l.label));
      expect(earn.length).toBeGreaterThan(0);
      expect(earn.every((l) => l.href === '/earn')).toBe(true);
    }
  });
});
