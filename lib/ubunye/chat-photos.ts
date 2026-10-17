import { UBUNYE_PHOTO_POLICY } from '@/lib/constants';

/**
 * Photos in the Ubunye chat. Pure and browser-safe.
 *
 * The chat API keeps only text parts, so a photo never travels in the chat
 * message. The browser resizes it, the photo route reads it and returns one
 * line ("Photo the client sent: ..."), and that line goes into the client's
 * text message. The client's own bubble shows the thumbnail and hides the line.
 */

/** The size a photo is drawn at: the long side at most maxSide, never made bigger. */
export function fitWithin(width: number, height: number, maxSide: number = UBUNYE_PHOTO_POLICY.maxSide): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const long = Math.max(width, height);
  if (long <= maxSide) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxSide / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** A plain refusal for a file that cannot be sent, or null when it can be resized. */
export function photoFileProblem(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith('image/')) return 'That file is not a photo. Choose a photo.';
  if (file.size > UBUNYE_PHOTO_POLICY.maxFileBytes) {
    const mb = Math.round(UBUNYE_PHOTO_POLICY.maxFileBytes / (1024 * 1024));
    return `That photo is over ${mb} MB. Choose a smaller one.`;
  }
  return null;
}

/** How many more photos fit in this message. */
export function photosLeft(current: number): number {
  return Math.max(0, UBUNYE_PHOTO_POLICY.perMessage - current);
}

/**
 * The one text part sent to Ubunye: the client's words, a blank line, then
 * each photo's description on its own line. No words: the photo-only words.
 */
export function composePhotoMessage(words: string, descriptions: readonly string[]): string {
  const said = words.trim();
  const lines = descriptions.map((d) => d.trim()).filter(Boolean);
  if (lines.length === 0) return said;
  return `${said || UBUNYE_PHOTO_POLICY.photoOnlyWords}\n\n${lines.join('\n')}`;
}

/** What the client sees in their own bubble: every photo description line taken out. */
export function visibleUserText(text: string): string {
  const prefix = UBUNYE_PHOTO_POLICY.descriptionPrefix;
  if (!text.includes(prefix)) return text;
  return text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith(prefix))
    .join('\n')
    .trimEnd();
}
