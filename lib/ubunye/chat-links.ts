import { STUDIO } from '@/lib/constants';

/**
 * Where a link in a Ubunye reply may go (Phase 6 security LLM-2 / LLM-3).
 * A hijacked or prompt-injected model can write any markdown; the chat must
 * not turn it into a zero-click image beacon or a phishing link.
 *
 *   internal  a same-site path ("/studio", never "//evil.example")
 *   external  https on our own site or an allowlisted host
 *             (STUDIO.security.chat.linkHosts + STUDIO.social), new tab
 *   text      anything else: shown as plain text, not clickable
 *
 * Images are never rendered (chatImageAlt gives the text to show instead).
 */
export type ChatLink =
  | { kind: 'internal'; href: string }
  | { kind: 'external'; href: string }
  | { kind: 'text' };

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
  const trimmed = href.trim();
  // A same-site path. "//host" and "/\host" are protocol-relative: off-site.
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\')) {
    return { kind: 'internal', href: trimmed };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { kind: 'text' };
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
