import { extractPhotoMetadata, type PhotoMetadata } from '@/lib/metadata/verification';
import { isHeic } from '@/lib/verification/photo-format';

/**
 * Browser side of the ID check, before upload.
 *
 * 1. Read the photo's EXIF from the untouched original.
 * 2. HEIC/HEIF (iPhone, some Samsung) becomes a full-size JPEG, because the
 *    server's image library cannot open HEIC. Safari decodes it natively;
 *    elsewhere the heic-to decoder (WebAssembly) is loaded only when needed.
 *
 * The photo is NOT shrunk here: it goes straight to private storage, and the
 * server reads the original, then makes the small review copy.
 */
export interface PreparedPhoto {
  file: File;
  meta: PhotoMetadata;
}

async function canvasToJpeg(bitmap: ImageBitmap): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
}

async function heicToJpeg(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const blob = await canvasToJpeg(bitmap);
    bitmap.close();
    if (blob) return blob;
  } catch {
    // Not decodable natively (Chrome, Firefox): use the decoder below.
  }
  const { heicTo } = await import('heic-to/csp');
  return heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const meta = await extractPhotoMetadata(await file.arrayBuffer());
  if (!isHeic(file)) return { file, meta };
  const jpeg = await heicToJpeg(file);
  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return { file: new File([jpeg], name, { type: 'image/jpeg', lastModified: file.lastModified }), meta };
}
