import { STUDIO } from '@/lib/constants';

/**
 * Where a link in a Ubunye reply may go (Phase 6 security LLM-2 / LLM-3).
 * A hijacked or prompt-injected model can write any markdown; the chat must
 * not turn it into a zero-click image beacon or a phishing link.
 *
 *   internal  a same-site path ("/studio", never "//evil.example")
 *   external  https on our own site or an allowlisted host
 *             (STUDIO.security.chat.linkHosts + STUDIO.social) or the
 *             studio's own WhatsApp number, new tab. Payment links are never
 *             taken from model text: payments go through /pay or the
 *             prepared-action card, which the server issues.
 *   text      anything else: shown as plain text, not clickable
 *
 * Images are never rendered (chatImageAlt gives the text to show instead).
 */
export type ChatLink =
  | { kind: 'internal'; href: string }
  | { kind: 'external'; href: string }
  | { kind: 'text' };

const INTERNAL_PROBE = 'https://x.invalid';

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Hosts a chat link may open. `extra` is the page's own host (preview, local). */
export function allowedChatHosts(extra: string[] = []): Set<string> {
  const hosts = new Set<string>(STUDIO.security.chat.linkHosts.map((h) => h.toLowerCase()));
  const site = hostOf(STUDIO.meta.url);
  if (site) {
    hosts.add(site);
    hosts.add(site.startsWith('www.') ? site.slice(4) : `www.${site}`);
  }
  for (const url of Object.values(STUDIO.social)) {
    const h = hostOf(url);
    if (h) hosts.add(h);
  }
  for (const h of extra) if (h) hosts.add(h.toLowerCase());
  return hosts;
}

export function chatLinkTarget(href: string | null | undefined, ownHost?: string): ChatLink {
  if (!href) return { kind: 'text' };
  // Browsers strip tabs/newlines and trim spaces from URLs, so "/\t/evil.com"
  // becomes "//evil.com" (off-site). Any whitespace or control character
  // makes the link plain text.
  if (/[\s\u0000-\u001f\u007f]/.test(href)) return { kind: 'text' };
  // A same-site path must resolve to the same origin as a probe base, so
  // "//host" and "/\host" (protocol-relative) are off-site.
  if (href.startsWith('/')) {
    try {
      return new URL(href, INTERNAL_PROBE).origin === INTERNAL_PROBE ? { kind: 'internal', href } : { kind: 'text' };
    } catch {
      return { kind: 'text' };
    }
  }
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { kind: 'text' };
  }
  // WhatsApp: only the studio's own number (a model must not send people to
  // another number).
  if (url.protocol === 'https:' && url.hostname === 'wa.me') {
    return url.pathname === `/${STUDIO.whatsapp.number}` && !url.username && !url.password
      ? { kind: 'external', href: url.href }
      : { kind: 'text' };
  }
  if (url.protocol === 'tel:') return { kind: 'external', href: url.href };
  if (url.protocol === 'mailto:') {
    const to = decodeURIComponent(url.pathname).toLowerCase();
    return [STUDIO.email, STUDIO.bookingEmail].some((e) => e.toLowerCase() === to) && !url.search
      ? { kind: 'external', href: url.href }
      : { kind: 'text' };
  }
  if (url.protocol !== 'https:' || url.username || url.password) return { kind: 'text' };
  return allowedChatHosts(ownHost ? [ownHost] : []).has(url.hostname.toLowerCase())
    ? { kind: 'external', href: url.href }
    : { kind: 'text' };
}

/** The text shown in place of an image in a reply (images are never loaded). */
export function chatImageAlt(alt: string | null | undefined): string {
  const text = (alt ?? '').trim();
  return text ? `[image: ${text}]` : '';
}
