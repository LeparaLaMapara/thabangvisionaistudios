import { STUDIO } from '@/lib/constants';

/**
 * The one sign-off every email we send ends with (owner's wording,
 * 2026-10-14). Templates put it in themselves; buildGmailMessage adds it to
 * any message that still lacks it, so no sender can forget it.
 *
 *   Warm regards,
 *   The ThabangVision team
 *   www.thabangvision.com
 */

/** The public site, always the live address, never a preview or localhost. */
export const SIGNATURE_URL = STUDIO.meta.url;

/** "www.thabangvision.com": the address as people read it. */
export const SIGNATURE_URL_LABEL = SIGNATURE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');

/** The line that tells a body already carries the signature. */
export const SIGNATURE_MARKER = `The ${STUDIO.name} team`;

export const SIGNATURE_LINES = ['Warm regards,', SIGNATURE_MARKER, SIGNATURE_URL_LABEL] as const;

/** Plain-text signature, three lines. */
export const SIGNATURE_TEXT = SIGNATURE_LINES.join('\n');

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * HTML signature: one paragraph, the address a link to the site.
 * `pStyle` / `linkStyle` let a branded layout match its own type.
 */
export function signatureHtml(opts: { pStyle?: string; linkStyle?: string } = {}): string {
  const p = opts.pStyle ? ` style="${escapeHtml(opts.pStyle)}"` : '';
  const a = opts.linkStyle ? ` style="${escapeHtml(opts.linkStyle)}"` : '';
  return `<p${p}>${escapeHtml(SIGNATURE_LINES[0])}<br>${escapeHtml(SIGNATURE_LINES[1])}<br><a href="${escapeHtml(SIGNATURE_URL)}"${a}>${escapeHtml(SIGNATURE_URL_LABEL)}</a></p>`;
}

export const SIGNATURE_HTML = signatureHtml();

/**
 * A sign-off we used before this signature, at the very end of a text body:
 * "ThabangVision", "— ThabangVision", "Thank you,\nThabangVision",
 * "Thabang, ThabangVision", optionally followed by our address or email.
 */
const NAME = STUDIO.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const OLD_TEXT_SIGNOFF = new RegExp(
  String.raw`(?:^|\n)[ \t]*(?:(?:Thank you|Thanks|Regards|Kind regards|Warm regards),?[ \t]*\n[ \t]*)?(?:[—–-][ \t]*\n?[ \t]*)?(?:[\p{L}'’-]+,[ \t]*)?${NAME}[ \t]*(?:\n[ \t]*(?:https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w.-]+))*\s*$`,
  'u',
);

/** Removes an old sign-off from the end of a text body, if there is one. */
export function stripOldTextSignOff(text: string): string {
  return text.replace(OLD_TEXT_SIGNOFF, '').replace(/\s+$/, '');
}

/** Text body ending with the signature exactly once. */
export function withTextSignature(text: string): string {
  if (text.includes(SIGNATURE_MARKER)) return text;
  const body = stripOldTextSignOff(text);
  return body ? `${body}\n\n${SIGNATURE_TEXT}` : SIGNATURE_TEXT;
}

/** HTML body with the signature exactly once: before </body> when there is one, else at the end. */
export function withHtmlSignature(html: string): string {
  if (html.includes(SIGNATURE_MARKER)) return html;
  const close = html.search(/<\/body\s*>/i);
  if (close === -1) return `${html}\n${SIGNATURE_HTML}`;
  return `${html.slice(0, close)}${SIGNATURE_HTML}\n${html.slice(close)}`;
}
