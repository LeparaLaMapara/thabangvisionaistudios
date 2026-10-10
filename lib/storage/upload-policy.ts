import { STUDIO } from '@/lib/constants';

/**
 * What a browser may upload with a signature from /api/cloudinary/sign.
 *
 * Phase 6 security INJ-5: the route signed whatever parameters the client
 * sent, so any signed-in user could upload to any public_id or folder
 * (overwriting someone else's photo, or writing into the reserved
 * listings/clean folder that marks a photo as metadata-free) and upload raw
 * files. Now the server decides:
 *   - the folder: a non-admin upload always lands under
 *     STUDIO.security.uploads.userRoot/<user id>/...; an admin may name a
 *     folder (same safe charset), as the admin tools do;
 *   - the kind: image (default) or video; nothing else;
 *   - the signed parameters: folder, timestamp and allowed_formats only.
 *     A client public_id, overwrite, upload_preset, eager, notification_url
 *     or anything else is never signed, so Cloudinary refuses it.
 */

export type UploadKind = 'image' | 'video';

export interface UploadPolicy {
  kind: UploadKind;
  folder: string;
  /** Exactly the parameters to sign and to post with the file. */
  params: { folder: string; timestamp: string; allowed_formats: string };
}

const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

/** Folder segments a client asked for, keeping only safe ones. */
function safeSegments(requested: unknown): string[] {
  if (typeof requested !== 'string') return [];
  return requested
    .split('/')
    .map((s) => s.trim())
    .filter((s) => SEGMENT.test(s));
}

/**
 * The folder for an upload. A non-admin's requested folder only names a
 * sub-folder of their own namespace: "portfolios" -> <root>/<uid>/portfolios;
 * a path that already carries their id keeps the label before it and what
 * follows it ("profiles/<uid>" -> <root>/<uid>/profiles,
 * ".../portfolios/<uid>/<project>" -> <root>/<uid>/portfolios/<project>).
 */
export function uploadFolderFor(userId: string, isAdmin: boolean, requested: unknown): string {
  const segments = safeSegments(requested);
  if (isAdmin && segments.length > 0) return segments.slice(0, 8).join('/');

  const at = segments.indexOf(userId);
  const tail = at >= 0 ? [...segments.slice(Math.max(0, at - 1), at), ...segments.slice(at + 1)] : segments.slice(-2);
  const sub = tail.filter((s) => s !== userId).slice(0, 3);
  return [STUDIO.security.uploads.userRoot, userId, ...(sub.length ? sub : ['misc'])].join('/');
}

/** Image unless the client asked for a video; null for anything else (raw, auto, ...). */
export function uploadKindFor(requested: unknown): UploadKind | null {
  if (requested === undefined || requested === null || requested === '' || requested === 'image') return 'image';
  if (requested === 'video') return 'video';
  return null;
}

/** File extensions Cloudinary will accept for this kind of upload (signed as allowed_formats). */
export function allowedFormats(kind: UploadKind, isAdmin: boolean): readonly string[] {
  const u = STUDIO.security.uploads;
  if (kind === 'video') return isAdmin ? u.adminVideoFormats : u.videoFormats;
  return isAdmin ? u.adminImageFormats : u.imageFormats;
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic',
  heif: 'image/heif', avif: 'image/avif', gif: 'image/gif', tif: 'image/tiff', tiff: 'image/tiff',
  bmp: 'image/bmp', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v',
};

/**
 * The file-picker filter that matches the policy: MIME types (so phone
 * cameras still open with capture="environment") plus extensions.
 * `media` = images and videos. Never "image/*", which would offer SVG.
 */
export function uploadAccept(kind: UploadKind | 'media', isAdmin: boolean): string {
  const formats = kind === 'media' ? [...allowedFormats('image', isAdmin), ...allowedFormats('video', isAdmin)] : allowedFormats(kind, isAdmin);
  const mimes = [...new Set(formats.map((f) => MIME[f]).filter(Boolean))];
  return [...mimes, ...formats.map((f) => `.${f}`)].join(',');
}

/** The same filter in react-dropzone's shape ({ mime: [extensions] }). */
export function dropzoneAccept(kind: UploadKind | 'media', isAdmin: boolean): Record<string, string[]> {
  const formats = kind === 'media' ? [...allowedFormats('image', isAdmin), ...allowedFormats('video', isAdmin)] : allowedFormats(kind, isAdmin);
  const out: Record<string, string[]> = {};
  for (const f of formats) {
    const mime = MIME[f];
    if (mime) (out[mime] ??= []).push(`.${f}`);
  }
  return out;
}

export function uploadPolicy(
  userId: string,
  isAdmin: boolean,
  requested: { folder?: unknown; resource_type?: unknown },
  now: Date = new Date(),
): UploadPolicy | null {
  const kind = uploadKindFor(requested.resource_type);
  if (!kind) return null;
  const folder = uploadFolderFor(userId, isAdmin, requested.folder);
  const formats = allowedFormats(kind, isAdmin);
  return {
    kind,
    folder,
    params: { folder, timestamp: Math.round(now.getTime() / 1000).toString(), allowed_formats: formats.join(',') },
  };
}
