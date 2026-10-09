import type { ListingImage } from '@/lib/core/listings/input';

/**
 * Listing photos are uploaded straight from the browser, so the original file
 * (with any EXIF, including GPS, the phone wrote) sits in storage. Cloudinary
 * keeps that metadata on the untransformed original but strips it from any
 * transformed delivery. We store and publish a transformed URL (`q_auto`), so
 * the URL a renter can see never serves the owner's GPS position.
 *
 * Non-Cloudinary URLs are returned unchanged. The original upload is NOT
 * deleted or rewritten; stripping at upload time needs an upload preset
 * change (see docs/marketplace/listings.md).
 */

const UPLOAD_SEGMENT = '/image/upload/';
// A Cloudinary transformation segment: comma-separated `x_value` parameters.
const TRANSFORMATION = /^[a-z]{1,3}_[^/]*$/;

export function metadataFreeImageUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.hostname !== 'res.cloudinary.com') return url;
  const idx = parsed.pathname.indexOf(UPLOAD_SEGMENT);
  if (idx === -1) return url;
  const rest = parsed.pathname.slice(idx + UPLOAD_SEGMENT.length);
  const firstSegment = rest.split('/')[0] ?? '';
  if (TRANSFORMATION.test(firstSegment)) return url; // already transformed, so already stripped
  parsed.pathname = `${parsed.pathname.slice(0, idx)}${UPLOAD_SEGMENT}q_auto/${rest}`;
  return parsed.toString();
}

export function metadataFreeGallery(gallery: ListingImage[] | null): ListingImage[] | null {
  if (!gallery) return null;
  return gallery.map((img) => ({ url: metadataFreeImageUrl(img.url), public_id: img.public_id }));
}
