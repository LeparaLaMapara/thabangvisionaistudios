import { CREATOR_JOIN, RENTAL_POLICY, STUDIO } from '@/lib/constants';
import { OFFER_PATH } from '@/lib/welcome';
import { joinWords, rolePlural, type OfferedRole } from '@/lib/roles/offered';

/**
 * The public Earn page (/earn), in plain words. Pure: every number comes from
 * the rules the money code uses, so the page cannot promise more than we pay.
 *
 *   commission   STUDIO.booking.platformCommission, taken from the price
 *                before VAT (lib/bookings/pricing.ts splitServiceBooking)
 *   payout       STUDIO.booking.payoutDelayHours after the client approves,
 *                or autoApproveDeliveryAfterDays after delivery
 *                (lib/core/services/payouts)
 *   gear share   RENTAL_POLICY.ownerShareBps of the hire fee, deposit not
 *                shared; paid ownerPayoutDelayHours after a clean return,
 *                after a final check (lib/rental/owner-earnings.ts)
 */
export interface EarnContent {
  who: string[];
  steps: string[];
  keeps: string[];
  paid: string[];
  cta: { label: string; href: string };
}

export function earnContent(opts: { rolesOn: boolean; liveRoles: readonly OfferedRole[] }): EarnContent {
  const commission = STUDIO.booking.platformCommission;
  const ownerShare = RENTAL_POLICY.ownerShareBps / 100;
  const platformShare = RENTAL_POLICY.platformShareBps / 100;
  const roles = opts.rolesOn && opts.liveRoles.length > 0 ? joinWords(opts.liveRoles.map(rolePlural)) : 'photographers, videographers, editors and sound people';

  return {
    who: [
      `People who work on shoots: ${roles}. Clients find you under People.`,
      `People with camera, lighting or sound gear to rent out. Clients find it under Rentals.`,
      'No portfolio needed to start. You show your work as part of signing up.',
    ],
    steps: [
      'Create a free account.',
      opts.rolesOn ? 'Say what you offer and show your work: photos, a short video, or your CV.' : 'Set up your profile and add your work, or list your gear.',
      `A person on our team checks it, usually within 2 working days. If something needs fixing, we tell you how.`,
      'Do the one-time ID check (ID and selfie) and add a bank account in your own name.',
      'Clients book you on the site. You get the job details before the day, and do the work.',
    ],
    keeps: [
      `Work booked through ${STUDIO.shortName}: we keep ${commission}% of the booking price before VAT. You get the rest, and every booking in your dashboard shows the split.`,
      `Gear you rent out: you get ${ownerShare}% of the hire fee and we keep ${platformShare}%. The refundable deposit is not shared.`,
      'Signing up is free.',
    ],
    paid: [
      `Into the bank account in your own name, once your ID check has passed.`,
      `Photo and video work paid on the site: we send your money ${STUDIO.booking.payoutDelayHours} hours after the client approves the work. If the client does nothing, the work counts as approved ${STUDIO.booking.autoApproveDeliveryAfterDays} days after you deliver it.`,
      ...(opts.rolesOn ? ['Other kinds of work: a person on our team pays you by hand, into the same account.'] : []),
      `Gear: we send your share ${RENTAL_POLICY.ownerPayoutDelayHours} hours after the gear comes back in good order, after a final check by our team.`,
      'When it reaches your account after that depends on your bank.',
    ],
    cta: {
      label: 'Sign up to earn',
      href: opts.rolesOn ? OFFER_PATH : CREATOR_JOIN.href,
    },
  };
}
