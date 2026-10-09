import type { ListingImage } from '@/lib/core/listings/input';
import { storage as activeStorage, type StorageProvider } from '@/lib/storage';

/**
 * Listing photos are uploaded straight from the browser, so the original file
 * (with any EXIF, including GPS, the phone wrote) sits in storage. Cloudinary
 * keeps that metadata on the untransformed original but strips it from any
 * transformed delivery.
 *
 * Two layers:
 *   1. On every save, stored URLs are a transformed delivery (`q_auto`), so
 *      the URL on the listing never serves the owner's GPS position.
 *   2. On submit, cleanListingImages() re-uploads each photo FROM that
 *      transformed delivery into CLEAN_IMAGE_FOLDER and points the listing at
 *      the copies. The copy's original has no EXIF, so a URL rebuilt from a
 *      published public_id (or with the transformation removed) serves no
 *      GPS either. The browser upload is not deleted (see
 *      docs/marketplace/listings.md); it is no longer referenced by the
 *      listing.
 *
 * Non-Cloudinary URLs are returned unchanged by metadataFreeImageUrl.
 * cleanListingImages copies only images delivered from our own account
 * (/<our cloud>/image/upload/...) and refuses anything else; the listing
 * routes refuse new photos from anywhere else at save time (isOwnImageUrl).
 */

const CLOUDINARY_HOST = 'res.cloudinary.com';
const UPLOAD_SEGMENT = '/image/upload/';
// A delivery path: /<cloud name>/image/upload/<rest>. Anchored, so a fetch
// or other delivery type that merely contains "/image/upload/" further on
// (e.g. /<cloud>/image/fetch/https://elsewhere/image/upload/x.jpg) is not one.
const DELIVERY_PATH = /^\/([^/]+)\/image\/upload\/(.+)$/;
// A Cloudinary transformation segment: comma-separated `x_value` parameters.
const TRANSFORMATION = /^[a-z]{1,3}_[^/]*$/;
// Flags that make Cloudinary keep embedded metadata on a transformed delivery.
const KEEPS_METADATA = /keep_(iptc|attribution)/;
const VERSION = /^v\d+$/;

/** Where submit puts the metadata-free copies of listing photos. */
export const CLEAN_IMAGE_FOLDER = 'thabangvision_usecase/media/listings/clean';

interface CloudinaryParts {
  url: URL;
  /** Path up to and including /image/upload/. */
  prefix: string;
  transformations: string[];
  /** Everything after the transformations: optional version, then public id + extension. */
  rest: string[];
}

/**
 * A Cloudinary image delivery URL, split up: https, res.cloudinary.com, and a
 * path that starts with /<cloud>/image/upload/. With `owner`, the URL must
 * also be delivered from that provider's own account (ownsUrl), i.e. the
 * path starts with /<our cloud>/image/upload/. Anything else is null.
 */
function cloudinaryParts(url: string, owner?: StorageProvider): CloudinaryParts | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== CLOUDINARY_HOST) return null;
  const match = DELIVERY_PATH.exec(parsed.pathname);
  if (!match) return null;
  if (owner && owner.ownsUrl?.(url) !== true) return null;
  const segments = match[2].split('/');
  const transformations: string[] = [];
  while (segments.length > 1 && TRANSFORMATION.test(segments[0])) transformations.push(segments.shift() as string);
  return { url: parsed, prefix: `/${match[1]}${UPLOAD_SEGMENT}`, transformations, rest: segments };
}

/**
 * True when `url` is an image delivered from our own storage account (the
 * only photos a listing may use: the listing form uploads there).
 */
export function isOwnImageUrl(url: string, provider: StorageProvider = activeStorage): boolean {
  return cloudinaryParts(url, provider) !== null;
}

/** The asset's public id as written in a Cloudinary delivery URL, or null. */
export function cloudinaryPublicIdOf(url: string): string | null {
  const parts = cloudinaryParts(url);
  if (!parts) return null;
  const rest = VERSION.test(parts.rest[0] ?? '') ? parts.rest.slice(1) : parts.rest;
  if (rest.length === 0) return null;
  const joined = decodeURIComponent(rest.join('/'));
  const dot = joined.lastIndexOf('.');
  const slash = joined.lastIndexOf('/');
  return dot > slash ? joined.slice(0, dot) : joined;
}

export function metadataFreeImageUrl(url: string): string {
  const parts = cloudinaryParts(url);
  if (!parts) return url;
  if (parts.transformations.length > 0 && !parts.transformations.some((t) => KEEPS_METADATA.test(t))) {
    return url; // already transformed, so already stripped
  }
  // Untransformed, or transformed in a way that keeps metadata: deliver the
  // asset through a plain q_auto instead.
  parts.url.pathname = `${parts.prefix}q_auto/${parts.rest.join('/')}`;
  return parts.url.toString();
}

export function metadataFreeGallery(gallery: ListingImage[] | null): ListingImage[] | null {
  if (!gallery) return null;
  return gallery.map((img) => ({ url: metadataFreeImageUrl(img.url), public_id: img.public_id }));
}

/**
 * True when the photo is already a submit-time copy: in this account, in
 * CLEAN_IMAGE_FOLDER, and the URL really delivers the public id it claims.
 */
export function isCleanCopy(img: ListingImage, provider: StorageProvider = activeStorage): boolean {
  if (!img.public_id || !img.public_id.startsWith(`${CLEAN_IMAGE_FOLDER}/`)) return false;
  if (provider.ownsUrl?.(img.url) !== true) return false;
  return cloudinaryPublicIdOf(img.url) === img.public_id;
}

export type CleanImagesResult =
  | {
      ok: true;
      /** False when the listing already points only at clean copies. */
      changed: boolean;
      gallery: ListingImage[] | null;
      thumbnail_url: string | null;
      cover_public_id: string | null;
      /** Public ids created by this call (to discard if the caller gives up). */
      uploaded: string[];
    }
  | { ok: false; reason: 'unsupported_image' | 'storage_unavailable' | 'upload_failed' };

interface ListingPhotos {
  gallery: ListingImage[] | null;
  thumbnail_url: string | null;
  cover_public_id: string | null;
}

/**
 * Makes every photo of a listing a metadata-free copy in this account, and
 * the cover one of those copies. A listing saved before covers had to be one
 * of its photos (thumbnail only, no gallery) gets that thumbnail as its one
 * photo. Fails closed: if any photo cannot be copied, nothing is changed and
 * the copies already made are discarded.
 */
export async function cleanListingImages(
  listing: ListingPhotos,
  provider: StorageProvider = activeStorage,
): Promise<CleanImagesResult> {
  const source: ListingImage[] =
    listing.gallery && listing.gallery.length > 0
      ? listing.gallery
      : listing.thumbnail_url
        ? [{ url: listing.thumbnail_url, public_id: listing.cover_public_id ?? '' }]
        : [];
  if (source.length === 0) {
    return { ok: true, changed: false, gallery: listing.gallery, thumbnail_url: listing.thumbnail_url, cover_public_id: listing.cover_public_id, uploaded: [] };
  }

  let coverIndex = listing.cover_public_id ? source.findIndex((g) => g.public_id === listing.cover_public_id) : -1;
  if (coverIndex === -1 && listing.thumbnail_url) coverIndex = source.findIndex((g) => g.url === listing.thumbnail_url);
  if (coverIndex === -1) coverIndex = 0;

  const todo = source.map((img) => !isCleanCopy(img, provider));
  if (todo.some(Boolean)) {
    if (provider.name !== 'cloudinary' || !provider.isConfigured()) return { ok: false, reason: 'storage_unavailable' };
    // Only photos already in our account are copied. Anything else (another
    // Cloudinary account, a fetch/remote delivery, another host) is refused,
    // so this never pulls an arbitrary internet image into CLEAN_IMAGE_FOLDER.
    if (source.some((img, i) => todo[i] && !cloudinaryParts(img.url, provider))) return { ok: false, reason: 'unsupported_image' };
  }

  const settled = await Promise.allSettled(
    source.map((img, i) =>
      todo[i]
        ? (async () => provider.uploadImage(strippedDeliveryUrl(img.url, provider), CLEAN_IMAGE_FOLDER, 'image'))()
        : Promise.resolve(null),
    ),
  );
  const uploaded = settled.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value.public_id] : []));
  if (settled.some((r) => r.status === 'rejected')) {
    await discardUploadedImages(uploaded, provider);
    return { ok: false, reason: 'upload_failed' };
  }

  const gallery = source.map((img, i) => {
    const r = settled[i];
    const copy = r.status === 'fulfilled' ? r.value : null;
    return copy ? { url: metadataFreeImageUrl(copy.url), public_id: copy.public_id } : { url: metadataFreeImageUrl(img.url), public_id: img.public_id };
  });
  const cover = gallery[coverIndex];
  const result = { gallery, thumbnail_url: cover.url, cover_public_id: cover.public_id || null };
  const changed =
    uploaded.length > 0 ||
    JSON.stringify(result.gallery) !== JSON.stringify(listing.gallery) ||
    result.thumbnail_url !== listing.thumbnail_url ||
    result.cover_public_id !== listing.cover_public_id;
  return { ok: true, changed, ...result, uploaded };
}

/** A delivery of the asset with every transformation replaced by q_auto (which strips metadata). */
function strippedDeliveryUrl(url: string, provider: StorageProvider): string {
  const parts = cloudinaryParts(url, provider);
  if (!parts) throw new Error('strippedDeliveryUrl: not an image in our account');
  parts.url.pathname = `${parts.prefix}q_auto/${parts.rest.join('/')}`;
  parts.url.search = '';
  return parts.url.toString();
}

/** Best effort removal of copies this server made. Logs public ids only on failure. */
export async function discardUploadedImages(publicIds: string[], provider: StorageProvider = activeStorage): Promise<void> {
  await Promise.all(
    publicIds.map(async (id) => {
      try {
        await provider.deleteImage(id, 'image');
      } catch (err) {
        console.error('[listings/images] could not discard copy', id, err);
      }
    }),
  );
}
