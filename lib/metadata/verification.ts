import exifr from 'exifr';

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
