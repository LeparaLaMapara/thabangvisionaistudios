/**
 * Browser-safe reading of stored verification photo metadata (no exifr).
 *
 * profiles.verification_metadata is whatever the submission stored: the full
 * { id_front, id_back, selfie } object from POST /api/verifications, but `{}`
 * from the database's own defaults (submit_verification_* RPCs), null from
 * before EXIF extraction existed, or a partial object. The admin review
 * screen must render every one of these: an unexpected shape used to throw
 * and take down /admin/verifications for every submission in the list.
 */
import type { PhotoMetadata } from './verification';

export const EMPTY_PHOTO_METADATA: PhotoMetadata = Object.freeze({
  dateTaken: null,
  gps: null,
  device: null,
  software: null,
  imageWidth: null,
  imageHeight: null,
});

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** One photo's metadata, or the empty one when it is missing or malformed. */
export function photoMetadataOrEmpty(value: unknown): PhotoMetadata {
  if (!value || typeof value !== 'object') return EMPTY_PHOTO_METADATA;
  const m = value as Record<string, unknown>;
  const gps = m.gps as { latitude?: unknown; longitude?: unknown } | null | undefined;
  const lat = num(gps?.latitude);
  const lng = num(gps?.longitude);
  return {
    dateTaken: str(m.dateTaken),
    gps: lat !== null && lng !== null ? { latitude: lat, longitude: lng } : null,
    device: str(m.device),
    software: str(m.software),
    imageWidth: num(m.imageWidth),
    imageHeight: num(m.imageHeight),
  };
}

/** The three photos of a submission, each always present. */
export function verificationPhotos(value: unknown): { id_front: PhotoMetadata; id_back: PhotoMetadata; selfie: PhotoMetadata } {
  const m = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    id_front: photoMetadataOrEmpty(m.id_front),
    id_back: photoMetadataOrEmpty(m.id_back),
    selfie: photoMetadataOrEmpty(m.selfie),
  };
}
