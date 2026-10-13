/**
 * Which files the ID check accepts: photos only, in any format a phone saves.
 * Used by the page (picker, first check) and the route (the real check, on the
 * file's bytes rather than the name or type the browser reported).
 */

export const ID_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;

/** The picker's accept list. No PDF: we need a photo we can read and compare. */
export const ID_PHOTO_ACCEPT = ID_PHOTO_TYPES.join(',');

/** Largest original photo (it goes straight to storage, not through Vercel). */
export const MAX_ID_PHOTO_BYTES = 25 * 1024 * 1024;

/** Smallest: anything under this is too low quality to read. */
export const MIN_ID_PHOTO_BYTES = 50 * 1024;

export type IdPhotoType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';

const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'];

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/** The real format from the first bytes, or null when it is not a photo we take. */
export function sniffPhotoType(bytes: Uint8Array): IdPhotoType | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return 'image/png';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  if (ascii(bytes, 4, 4) === 'ftyp' && HEIF_BRANDS.includes(ascii(bytes, 8, 4))) return 'image/heic';
  return null;
}

/** HEIC/HEIF by type or, when the phone reports no type, by file name. */
export function isHeic(file: { type: string; name: string }): boolean {
  return /^image\/hei[cf]/.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

export function validateIdPhoto(file: { type: string; name: string; size: number }): { valid: boolean; error?: string } {
  const isPhoto = (ID_PHOTO_TYPES as readonly string[]).includes(file.type) || isHeic(file);
  if (!isPhoto) {
    return { valid: false, error: 'Please use a photo (JPG, PNG, WebP or HEIC). PDFs and scans are not accepted.' };
  }
  if (file.size < MIN_ID_PHOTO_BYTES) {
    return { valid: false, error: 'This photo is too small to read. Please take a clearer photo.' };
  }
  if (file.size > MAX_ID_PHOTO_BYTES) {
    return { valid: false, error: 'This photo is too large. Please take it again with your phone camera.' };
  }
  return { valid: true };
}

/** Plain words for a refused request, including the host's 413. */
export function submitErrorMessage(status: number, serverError: string | undefined): string {
  if (serverError) return serverError;
  if (status === 413) {
    return 'Your photos are too large to send. Please refresh this page and try again.';
  }
  return 'Failed to submit documents. Please try again.';
}
