/**
 * The site's public base URL, without a trailing slash.
 *
 * NEXT_PUBLIC_APP_URL in Vercel was saved with a trailing newline (the usual
 * `echo value | vercel env add` slip), so gluing a path onto the raw value
 * sent Paystack callback URLs like "https://www.thabangvision.com\n/...".
 * Every caller reads the URL through here so stray whitespace can never
 * reach a payment provider, an email link or a redirect again.
 */
export function appUrl(fallback = 'http://localhost:3000'): string {
  // Literal process.env read, so Next.js still inlines it in client bundles.
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  return cleanBaseUrl(raw) || cleanBaseUrl(fallback);
}

/** Trims whitespace and trailing slashes from a base URL. */
export function cleanBaseUrl(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

/** Reads a "true"/"false" env flag, ignoring case and stray whitespace. */
export function envFlag(value: string | null | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === 'true';
}
