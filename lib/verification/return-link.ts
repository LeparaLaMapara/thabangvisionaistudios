/**
 * What the ID check page offers next. Pure, so it is tested.
 *
 * The page used to label every ?redirect= as "Back to your booking", so a
 * creator sent there from onboarding (redirect=/dashboard) was told to go
 * back to a booking they never had.
 */

/** Pages someone is booking or renting from when we ask for their ID. */
const BOOKING_PREFIXES = ['/rentals', '/dashboard/cart', '/dashboard/bookings', '/checkout', '/book', '/pay'];

export type VerificationNext =
  | { kind: 'booking'; href: string }
  | { kind: 'creator'; draftedGear: number }
  | { kind: 'continue'; href: string }
  | null;

function startsWithPath(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);
}

/**
 * @param redirect an already cleaned, on-site path (safeNextPath), or ''.
 * @param from where they came from (?from=onboarding), if known.
 */
export function verificationNext(params: {
  redirect: string;
  from?: string | null;
  drafted?: string | number | null;
}): VerificationNext {
  const redirect = params.redirect ?? '';
  const drafted = Math.max(0, Math.floor(Number(params.drafted ?? 0)) || 0);

  if (redirect && BOOKING_PREFIXES.some((p) => startsWithPath(redirect, p))) {
    return { kind: 'booking', href: redirect };
  }
  // From creator onboarding (or an older link that sent ?redirect=/dashboard).
  if (params.from === 'onboarding' || redirect === '/dashboard' || startsWithPath(redirect, '/onboarding')) {
    return { kind: 'creator', draftedGear: drafted };
  }
  if (redirect) return { kind: 'continue', href: redirect };
  return null;
}
