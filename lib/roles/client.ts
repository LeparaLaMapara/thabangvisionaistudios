/**
 * Browser helpers for the profile maker. Client-only (canvas, fetch).
 *
 * Built for a cheap Android phone on little data: photos are made smaller
 * before upload (the long edge to ROLE_UPLOAD.maxEdge), after their EXIF is
 * read from the untouched original.
 */
import { preparePhoto } from '@/lib/verification/prepare-photo';
import type { PhotoMetadata } from '@/lib/metadata/verification';

export const ROLE_UPLOAD = {
  maxEdge: 1600,
  jpegQuality: 0.82,
  maxVideoBytes: 60 * 1024 * 1024,
} as const;

export interface ReadyFile {
  file: File;
  meta: PhotoMetadata | null;
  lastModified: number;
}

async function shrink(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, ROLE_UPLOAD.maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', ROLE_UPLOAD.jpegQuality));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  }
}

/** Read EXIF from the original, convert HEIC, then shrink. Videos pass through. */
export async function readyForUpload(file: File): Promise<ReadyFile> {
  const lastModified = file.lastModified;
  if (file.type.startsWith('video/')) {
    if (file.size > ROLE_UPLOAD.maxVideoBytes) throw new Error('That video is too big. Keep it under a minute.');
    return { file, meta: null, lastModified };
  }
  const prepared = await preparePhoto(file);
  return { file: await shrink(prepared.file), meta: prepared.meta, lastModified };
}
