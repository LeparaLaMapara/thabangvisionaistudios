/**
 * Shared checks for short free-text profile fields that end up on public pages
 * (creator pages, JSON-LD, search results). Rendering is escaped everywhere
 * (React text, renderJsonLd), so these are a second layer: refuse markup at
 * the door so a stored value is never a payload in the first place.
 *
 * The database enforces the same rule for these columns (migration 079,
 * profiles_reject_markup), because the profile page writes some of them
 * straight to Supabase.
 */

/** Characters that only ever appear in a name or a place as an attack. */
const MARKUP = /[<>]/;

/** True when the text holds `<` or `>`. */
export function hasMarkup(text: string): boolean {
  return MARKUP.test(text);
}

/**
 * A city or province name: letters (any script, with accents), digits for
 * places like "Midrand 2", spaces and the punctuation real place names use.
 */
const PLACE = /^[\p{L}\p{M}0-9\s'.,()&/-]+$/u;
export const PLACE_MAX_LENGTH = 80;

export function validatePlaceName(value: unknown, label: string): { valid: boolean; error?: string } {
  if (typeof value !== 'string' || !value.trim()) {
    return { valid: false, error: `${label} is required.` };
  }
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > PLACE_MAX_LENGTH) {
    return { valid: false, error: `${label} must be between 2 and ${PLACE_MAX_LENGTH} characters.` };
  }
  if (!PLACE.test(trimmed)) {
    return { valid: false, error: `${label} contains invalid characters.` };
  }
  return { valid: true };
}

/**
 * Free text that is not a name (a street address, a postal code): any
 * printable text up to a length, but never markup.
 */
export function validatePlainText(
  value: unknown,
  label: string,
  maxLength: number,
): { valid: boolean; error?: string } {
  if (typeof value !== 'string') return { valid: false, error: `${label} is required.` };
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    return { valid: false, error: `${label} must be ${maxLength} characters or fewer.` };
  }
  if (hasMarkup(trimmed)) return { valid: false, error: `${label} contains invalid characters.` };
  return { valid: true };
}
