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
/** An answer on the account: one of the four, or "just looking around". */
export type SavedIntent = WelcomeIntent | 'browse';

export interface WelcomeChoice {
  intent: WelcomeIntent;
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
  return value === 'rent' || value === 'hire' || value === 'list' || value === 'supply' || value === 'browse';
}

/** Where a signed-in person lands when nothing else says where to go. */
export function homeFor(intent: unknown, onboarded: boolean): string {
  if (intent === 'supply') return onboarded ? '/dashboard' : '/onboarding';
  if (intent === 'list') return '/dashboard/listings';
  if (isWelcomeIntent(intent)) return '/dashboard';
  return '/welcome';
}
