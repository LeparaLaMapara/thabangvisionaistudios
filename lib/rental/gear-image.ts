/**
 * Product photos for the rentals grid, all on one background.
 *
 * Listing photos arrive on white, dark or busy backgrounds; side by side they
 * look untidy. Cloudinary removes the background and pads every photo to a
 * square on the card colour, so the grid reads as one set. The original photo
 * is untouched (the result is a cached derived image). Text printed on a photo
 * stays, because it is part of the picture.
 */
export const GEAR_CARD_BACKGROUND = '141414';

export function gearCardImage(url: string): string {
  if (!url.includes('res.cloudinary.com') || !url.includes('/image/upload/')) return url;
  return url.replace(
    '/image/upload/',
    `/image/upload/e_background_removal/c_pad,ar_1:1,b_rgb:${GEAR_CARD_BACKGROUND}/`,
  );
}

/** The same photo without background removal, used if the cleaned one fails to load. */
export function gearCardImageFallback(url: string): string {
  if (!url.includes('res.cloudinary.com') || !url.includes('/image/upload/')) return url;
  return url.replace('/image/upload/', `/image/upload/c_pad,ar_1:1,b_rgb:${GEAR_CARD_BACKGROUND}/`);
}
