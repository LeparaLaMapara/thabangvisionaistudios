import { permanentRedirect } from 'next/navigation';

/**
 * Signing up and signing in are one screen now (/login, spec 9.1). Old
 * links to /register keep working: every query parameter is carried over
 * (?redirect=, ?next=, ?reason=; /login sanitises the destination), and
 * ?mode=signup only changes the heading there.
 */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === 'mode') continue;
    if (Array.isArray(value)) value.forEach((v) => query.append(key, v));
    else if (typeof value === 'string') query.append(key, value);
  }
  query.set('mode', 'signup');
  permanentRedirect(`/login?${query.toString()}`);
}
