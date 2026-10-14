import sharp from 'sharp';

/**
 * The copy of an ID-check photo we keep: upright, long edge at most 2400 px,
 * JPEG, with all EXIF/GPS removed (sharp drops metadata unless asked to keep
 * it). The original's details were read before this; the original is deleted.
 */
export const REVIEW_MAX_EDGE = 2400;

export async function makeReviewCopy(original: Buffer): Promise<Buffer> {
  return sharp(original, { failOn: 'error', limitInputPixels: 120_000_000 })
    .rotate()
    .resize({ width: REVIEW_MAX_EDGE, height: REVIEW_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}

/** Width and height of a photo as stored (before EXIF rotation; the shortest side is what matters). */
export async function photoSize(original: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const { width, height } = await sharp(original, { limitInputPixels: 120_000_000 }).metadata();
    return width && height ? { width, height } : null;
  } catch {
    return null;
  }
}
