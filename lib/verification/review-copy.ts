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
