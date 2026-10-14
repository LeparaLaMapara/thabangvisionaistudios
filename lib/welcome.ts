/**
 * The things people come to ThabangVision to do, asked once after signing up
 * (app/(platform)/welcome). One place, so the welcome page, the dashboard and
 * any welcome message agree on the words and the destinations.
 *
 * Owners of gear and creators offering services are separate answers: an
 * owner who only wants to rent out a camera goes straight to a photo-first
 * listing (/dashboard/listings?new=1), not through creator onboarding.
 */
export type WelcomeIntent = 'rent' | 'hire' | 'list' | 'supply';
/**
 * An answer on the account: one of the four, "just looking around", or (with
 * roles_v1) one of the two journeys, find or offer.
 */
export type SavedIntent = WelcomeIntent | 'browse' | Journey;

export interface WelcomeChoice {
  intent: WelcomeIntent | 'offer';
  title: string;
  detail: string;
  href: string;
}

/** Where "List my gear" lands: a new listing, starting with the photo. */
export const LIST_GEAR_HREF = '/dashboard/listings?new=1';

export const WELCOME_CHOICES: readonly WelcomeChoice[] = [
  {
    intent: 'rent',
    title: 'Rent camera gear',
    detail: 'Cameras, lenses, lights and sound, by the day or the week.',
    href: '/rentals',
  },
  {
    intent: 'hire',
    title: 'Book a photographer or videographer',
    detail: 'For a birthday, a wedding, a shoot or an event.',
    href: '/studio',
  },
  {
    intent: 'list',
    title: 'List my gear',
    detail: 'Rent out your camera kit. Start with a photo; we suggest the details and a price.',
    href: LIST_GEAR_HREF,
  },
  {
    intent: 'supply',
    title: 'Offer my services',
    detail: 'Photography, video, editing or sound: show your work and get booked.',
    href: '/onboarding',
  },
] as const;

export function isWelcomeIntent(value: unknown): value is SavedIntent {
  return (
    value === 'rent' || value === 'hire' || value === 'list' || value === 'supply' || value === 'browse' ||
    value === 'find' || value === 'offer'
  );
}

/** Where a signed-in person lands when nothing else says where to go. */
export function homeFor(intent: unknown, onboarded: boolean): string {
  if (intent === 'supply') return onboarded ? '/dashboard' : '/onboarding';
  if (intent === 'offer') return onboarded ? '/dashboard' : OFFER_PATH;
  if (intent === 'list') return '/dashboard/listings';
  if (isWelcomeIntent(intent)) return '/dashboard';
  return '/welcome';
}

// ─── One way in for offering (roles_v1, TASK-085) ───────────────────────────
// Finding is already solved by the site: people browse photographers and gear,
// pick, book, and the ID check follows. Offering had three doors (creator
// onboarding, list my gear, join as a role). With roles_v1 on there is one:
// Offer. The person says what they offer in their own words (or adds a photo),
// we suggest where it fits, they tap to confirm: a skill goes to the profile
// maker, gear to the photo-first listing, a vehicle to driver with vehicle.
// /join, /onboarding and the welcome "offer" choice all land there.

export type Journey = 'find' | 'offer';

export const OFFER_PATH = '/offer';
/** The profile maker for one role, inside Offer. */
export function offerRolePath(slug: string): string {
  return `${OFFER_PATH}/${encodeURIComponent(slug)}`;
}

/** The welcome question with roles_v1 on: renting and booking as today, one Offer choice. */
export const WELCOME_CHOICES_ROLES: readonly WelcomeChoice[] = [
  WELCOME_CHOICES[0],
  WELCOME_CHOICES[1],
  {
    intent: 'offer',
    title: 'Offer something',
    detail: 'Your skills, your gear or your vehicle. No portfolio needed.',
    href: OFFER_PATH,
  },
] as const;

/** Which journey a saved answer belongs to. Old answers keep working. */
export function journeyOf(intent: unknown): Journey | 'browse' | null {
  if (intent === 'rent' || intent === 'hire' || intent === 'find') return 'find';
  if (intent === 'list' || intent === 'supply' || intent === 'offer') return 'offer';
  if (intent === 'browse') return 'browse';
  return null;
}
