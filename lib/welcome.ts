/**
 * The three things people come to ThabangVision to do, asked once after
 * signing up (app/(platform)/welcome). One place, so the welcome page, the
 * dashboard and any welcome message agree on the words and the destinations.
 */
export type WelcomeIntent = 'rent' | 'hire' | 'supply';
/** An answer on the account: one of the three, or "just looking around". */
export type SavedIntent = WelcomeIntent | 'browse';

export interface WelcomeChoice {
  intent: WelcomeIntent;
  title: string;
  detail: string;
  href: string;
}

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
    intent: 'supply',
    title: 'Offer my gear or my services',
    detail: 'Supply your camera kit or your skills to ThabangVision.',
    href: '/onboarding',
  },
] as const;

export function isWelcomeIntent(value: unknown): value is SavedIntent {
  return value === 'rent' || value === 'hire' || value === 'supply' || value === 'browse';
}

/** Where a signed-in person lands when nothing else says where to go. */
export function homeFor(intent: unknown, onboarded: boolean): string {
  if (intent === 'supply') return onboarded ? '/dashboard' : '/onboarding';
  if (isWelcomeIntent(intent)) return '/dashboard';
  return '/welcome';
}
