import exifr from 'exifr';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ImageMetadata {
  camera?: string;
  lens?: string;
  focalLength?: number;
  aperture?: number;
  iso?: number;
  shutterSpeed?: string;
  dateTaken?: string;
  gps?: { latitude: number; longitude: number };
  width?: number;
  height?: number;
  software?: string;
}

// ─── Extract EXIF from an image buffer ──────────────────────────────────────

export async function extractMetadataFromBuffer(
  buffer: ArrayBuffer,
): Promise<ImageMetadata> {
  try {
    const exif = await exifr.parse(buffer, {
      pick: [
        'Make', 'Model', 'LensModel', 'FocalLength',
        'FNumber', 'ISO', 'ExposureTime', 'DateTimeOriginal',
        'GPSLatitude', 'GPSLongitude', 'ImageWidth', 'ImageHeight',
        'Software',
      ],
    });

    if (!exif) return {};

    return {
      camera: exif.Make && exif.Model
        ? `${exif.Make} ${exif.Model}`.replace(/\s+/g, ' ').trim()
        : undefined,
      lens: exif.LensModel || undefined,
      focalLength: exif.FocalLength || undefined,
      aperture: exif.FNumber || undefined,
      iso: exif.ISO || undefined,
      shutterSpeed: exif.ExposureTime
        ? formatShutterSpeed(exif.ExposureTime)
        : undefined,
      dateTaken: exif.DateTimeOriginal
        ? new Date(exif.DateTimeOriginal).toISOString()
        : undefined,
      gps: exif.GPSLatitude != null && exif.GPSLongitude != null
        ? { latitude: exif.GPSLatitude, longitude: exif.GPSLongitude }
        : undefined,
      width: exif.ImageWidth || undefined,
      height: exif.ImageHeight || undefined,
      software: exif.Software || undefined,
    };
  } catch {
    return {};
  }
}

// ─── Extract EXIF from a URL (fetches the image) ───────────────────────────

export async function extractMetadataFromUrl(
  imageUrl: string,
): Promise<ImageMetadata> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return {};
    const buffer = await response.arrayBuffer();
    return extractMetadataFromBuffer(buffer);
  } catch {
    return {};
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatShutterSpeed(exposureTime: number): string {
  if (exposureTime >= 1) {
    return `${exposureTime}s`;
  }
  const denominator = Math.round(1 / exposureTime);
  return `1/${denominator}s`;
}

/**
 * Formats metadata into a human-readable summary line.
 * e.g. "85mm  f/1.8  ISO 400  1/200s"
 */
export function formatMetadataSummary(meta: ImageMetadata): string {
  const parts: string[] = [];
  if (meta.focalLength) parts.push(`${meta.focalLength}mm`);
  if (meta.aperture) parts.push(`f/${meta.aperture}`);
  if (meta.iso) parts.push(`ISO ${meta.iso}`);
  if (meta.shutterSpeed) parts.push(meta.shutterSpeed);
  return parts.join('  ');
}
