/**
 * Keeps an ID-check submission under the hosting limit.
 *
 * Vercel refuses a request body over 4.5 MB before our route runs, with a
 * plain-text 413 the page could not read, so people saw only "Failed to
 * submit documents." Two ordinary phone photos are often over that together.
 * The page now shrinks large photos in the browser first (long edge 2400 px is
 * plenty for the face match and for the person who checks them) and reads the
 * photo's EXIF before shrinking, because a canvas drops it.
 */

/** Total the page may send: under Vercel's 4.5 MB with room for the form. */
export const UPLOAD_BUDGET_BYTES = 4 * 1024 * 1024;

/** A photo above this is shrunk before upload. */
export const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;

/** Largest original photo the page accepts (it is shrunk before upload). */
export const MAX_ORIGINAL_PHOTO_BYTES = 30 * 1024 * 1024;

/** Formats a browser can redraw on a canvas everywhere (not HEIC, not PDF). */
const SHRINKABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp'];

/** Long-edge sizes and JPEG qualities, tried in order until the photo is small enough. */
export const SHRINK_STEPS: readonly { maxEdge: number; quality: number }[] = [
  { maxEdge: 2400, quality: 0.86 },
  { maxEdge: 1800, quality: 0.8 },
  { maxEdge: 1400, quality: 0.75 },
];

export function canShrink(type: string): boolean {
  return SHRINKABLE_TYPES.includes(type);
}

export function needsShrink(file: { type: string; size: number }): boolean {
  return canShrink(file.type) && file.size > SHRINK_ABOVE_BYTES;
}

/** Size that keeps the aspect ratio with the long edge at most maxEdge. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height };
  const scale = maxEdge / long;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function fitsUploadBudget(sizes: number[]): boolean {
  return sizes.reduce((a, b) => a + b, 0) <= UPLOAD_BUDGET_BYTES;
}

/** Plain words for a refused submission, including the host's 413. */
export function submitErrorMessage(status: number, serverError: string | undefined): string {
  if (serverError) return serverError;
  if (status === 413) {
    return 'Your photos are too large to send together. Take them again with the camera button, or choose smaller photos.';
  }
  return 'Failed to submit documents. Please try again.';
}

/**
 * Redraws a photo smaller as a JPEG. Returns the original when it is already
 * small, cannot be redrawn (HEIC on most phones, PDF), or the browser fails.
 */
export async function shrinkPhoto(file: File): Promise<File> {
  if (!needsShrink(file)) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    let best: Blob | null = null;
    for (const step of SHRINK_STEPS) {
      const { width, height } = fitWithin(bitmap.width, bitmap.height, step.maxEdge);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) break;
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', step.quality));
      if (!blob) break;
      best = blob;
      if (blob.size <= SHRINK_ABOVE_BYTES) break;
    }
    bitmap.close();
    if (!best || best.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([best], name, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  }
}
