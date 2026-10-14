/**
 * Where to send someone after they sign in or sign up: back to the page they
 * came from, and never off the site.
 *
 * Only a same-site path is accepted ("/rentals/x?y=1"). Anything that could
 * leave the site or run script (a full URL, "//evil.com", a backslash path,
 * "javascript:...") falls back, which closes the open redirect the login page
 * had (it assigned ?redirect= straight to window.location).
 */
export const DEFAULT_AFTER_SIGN_IN = '/dashboard';

export function safeNextPath(value: string | null | undefined, fallback: string = DEFAULT_AFTER_SIGN_IN): string {
  if (!value) return fallback;
  let path: string;
  try {
    path = decodeURIComponent(value).trim();
  } catch {
    return fallback;
  }
  if (!path.startsWith('/')) return fallback;
  if (path.startsWith('//') || path.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(path)) return fallback;
  return path;
}

/** The Google / email-confirmation return address, carrying where to go next. */
export function authCallbackUrl(origin: string, next: string): string {
  const safe = safeNextPath(next, '');
  return safe && safe !== DEFAULT_AFTER_SIGN_IN
    ? `${origin}/auth/callback?next=${encodeURIComponent(safe)}`
    : `${origin}/auth/callback`;
}

/** A link to another auth page that keeps the destination, e.g. "/register?redirect=%2Frentals". */
export function withRedirect(page: '/login' | '/register', next: string): string {
  const safe = safeNextPath(next, '');
  return safe && safe !== DEFAULT_AFTER_SIGN_IN ? `${page}?redirect=${encodeURIComponent(safe)}` : page;
}

/** Plain words for the ?error= codes the auth callback sends back. */
export function signInErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  if (code === 'auth') {
    return "Sign-in didn't finish. If you just confirmed your email, sign in below with your email and password. Otherwise please try again, or contact us and we'll help.";
  }
  return 'Something went wrong signing you in. Please try again.';
}

/**
 * A suspended account is banned in Supabase Auth, which answers "User is
 * banned". Said plainly, with where to ask, instead.
 */
export function bannedMessage(err: { message?: string; code?: string } | null | undefined, contactEmail: string): string | null {
  if (!err) return null;
  if (err.code === 'user_banned' || /banned/i.test(err.message ?? '')) {
    return `This account is suspended, so it cannot sign in. If you think this is a mistake, email ${contactEmail}.`;
  }
  return null;
}
