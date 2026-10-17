import { GEAR_RENTAL_CATEGORIES, ON_SITE_RENTAL, STUDIO } from '@/lib/constants';
import { sanitiseForPrompt } from './sanitise';

/**
 * What ThabangVision offers, for the system prompt. Pure.
 *
 * Built from the data, never from a second hand-kept list: People roles from
 * the `roles` table (live, with or without someone approved, and coming
 * soon), gear from RENTAL_CATEGORIES, the studio from ON_SITE_RENTAL. Plus
 * one short rule for anything else, so "can you help me buy shares?" gets a
 * short honest no and never a made-up workflow.
 */

export interface CapabilityRoles {
  live: { slug: string; name: string }[];
  offered: { slug: string; name: string }[];
  comingSoon: { slug: string; name: string }[];
  ok: boolean;
}

const names = (xs: { name: string }[]): string => xs.map((x) => sanitiseForPrompt(x.name, 60)).join(', ');

export function capabilityBlock(roles: CapabilityRoles | null, peopleOn: boolean): string {
  const lines: string[] = ['===== WHAT WE CAN DO (from our live data; this is the complete list) ====='];
  if (peopleOn && roles?.ok) {
    const bookableNow = roles.offered;
    const liveEmpty = roles.live.filter((r) => !roles.offered.some((o) => o.slug === r.slug));
    lines.push(`- People you can book now: ${bookableNow.length ? names(bookableNow) : 'nobody is listed yet'}. Use find_people to show them.`);
    if (liveEmpty.length) lines.push(`- People roles open but with nobody listed yet: ${names(liveEmpty)}.`);
    if (roles.comingSoon.length) lines.push(`- People roles coming soon (not bookable yet): ${names(roles.comingSoon)}.`);
  } else if (peopleOn) {
    lines.push('- People: photographers and other people are booked on /people. Use find_people to show them.');
  }
  lines.push(`- Gear to rent (categories): ${GEAR_RENTAL_CATEGORIES.map((c) => `${c.label} (${c.value})`).join(', ')}.`);
  lines.push(`- Studio: ${ON_SITE_RENTAL.studioName}, booked by full days under Rentals, Studios (${ON_SITE_RENTAL.studiosPath}).`);
  lines.push(`- Where: ${STUDIO.serviceArea.province}. ${STUDIO.serviceArea.outsideProvinceNote}`);
  lines.push('ANYTHING ELSE (for example shares or investing, loans, catering, venues, decor, DJs, legal or tax advice, flights): say in one or two sentences that we do not offer it, then mention what we do offer if it could help. Do not invent a workflow, a partner, a referral or a price for it. A role marked coming soon is not bookable: say so plainly.');
  return lines.join('\n');
}
