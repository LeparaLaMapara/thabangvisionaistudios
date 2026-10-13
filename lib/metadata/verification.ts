import exifr from 'exifr';
import type { IdDocumentSummary } from '@/lib/verification/id-reading';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PhotoMetadata {
  dateTaken: string | null;
  gps: { latitude: number; longitude: number } | null;
  device: string | null;
  software: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
}

export interface VerificationMetadata {
  id_front: PhotoMetadata;
  id_back: PhotoMetadata;
  selfie: PhotoMetadata;
  face_match?: {
    match: boolean;
    confidence: number;
    reasoning: string;
    checked_at: string;
  } | null;
  /** What the vision model read from the ID photo (lib/verification/id-reading.ts). */
  id_document?: IdDocumentSummary | null;
}

// ─── EXIF Extraction ────────────────────────────────────────────────────────

export async function extractPhotoMetadata(
  fileBuffer: ArrayBuffer,
): Promise<PhotoMetadata> {
  try {
    const exif = await exifr.parse(fileBuffer, {
      pick: [
        'DateTimeOriginal',
        'GPSLatitude',
        'GPSLongitude',
        'Make',
        'Model',
        'Software',
        'ImageWidth',
        'ImageHeight',
      ],
    });

    if (!exif) return emptyMetadata();

    return {
      dateTaken: exif.DateTimeOriginal?.toISOString() || null,
      gps:
        exif.GPSLatitude && exif.GPSLongitude
          ? { latitude: exif.GPSLatitude, longitude: exif.GPSLongitude }
          : null,
      device:
        exif.Make && exif.Model
          ? `${exif.Make} ${exif.Model}`.trim()
          : null,
      software: exif.Software || null,
      imageWidth: exif.ImageWidth || null,
      imageHeight: exif.ImageHeight || null,
    };
  } catch {
    return emptyMetadata();
  }
}

function emptyMetadata(): PhotoMetadata {
  return {
    dateTaken: null,
    gps: null,
    device: null,
    software: null,
    imageWidth: null,
    imageHeight: null,
  };
}

// ─── Metadata the browser read before converting a photo ─────────────────────

function cleanText(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null;
}

function cleanNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * The page reads a photo's EXIF before converting it (a HEIC photo turned into
 * JPEG in the browser has none) and sends it beside the file. It is no less trustworthy than EXIF inside an
 * uploaded file, which the sender controls just the same. Anything malformed
 * becomes null.
 */
export function sanitizeClientMetadata(raw: unknown): PhotoMetadata | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const date = cleanText(r.dateTaken);
  const gpsRaw = r.gps as Record<string, unknown> | null | undefined;
  const lat = cleanNumber(gpsRaw?.latitude);
  const lon = cleanNumber(gpsRaw?.longitude);
  return {
    dateTaken: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null,
    gps: lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { latitude: lat, longitude: lon } : null,
    device: cleanText(r.device),
    software: cleanText(r.software),
    imageWidth: cleanNumber(r.imageWidth),
    imageHeight: cleanNumber(r.imageHeight),
  };
}

/** True when nothing useful came out of a photo's EXIF. */
export function isEmptyMetadata(m: PhotoMetadata): boolean {
  return !m.dateTaken && !m.device && !m.gps && !m.software;
}

/** The file's own EXIF when it has any, else what the browser read before shrinking. */
export function preferFileMetadata(fromFile: PhotoMetadata, fromBrowser: PhotoMetadata | null): PhotoMetadata {
  return isEmptyMetadata(fromFile) && fromBrowser ? fromBrowser : fromFile;
}
