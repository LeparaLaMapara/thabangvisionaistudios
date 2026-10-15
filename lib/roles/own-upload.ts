/**
 * Whose upload is this? Pure.
 *
 * The browser uploads work straight to our Cloudinary account (signed by
 * /api/cloudinary/sign into the person's own folder) and then sends us the
 * URL. The public id is worked out HERE from the URL's path. The client's
 * own `public_id` is never trusted: before 2026-10-15 a victim's photo URL
 * with "?x=<root>/users/<my id>/y" added passed the "own upload" check,
 * because the check only asked that the client's id appear somewhere in the
 * URL (security re-check M3).
 *
 * Accepted: https://res.cloudinary.com/<cloud>/<image|video|raw>/upload/[v<digits>/]<public id>.<ext>
 * with no query, no fragment and no transformation, where the public id has
 * the person's user id as one of its folders.
 */
export function ownUploadPublicId(rawUrl: unknown, userId: string, cloudName: string | undefined): string | null {
  if (typeof rawUrl !== 'string' || !cloudName || !userId || rawUrl.length > 600) return null;
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'res.cloudinary.com' || u.port || u.username || u.password) return null;
  if (u.search || u.hash || rawUrl.includes('?') || rawUrl.includes('#')) return null;
  const m = /^\/([^/]+)\/(image|video|raw)\/upload\/(?:v\d+\/)?(.+)$/.exec(u.pathname);
  if (!m || m[1] !== cloudName) return null;
  let rest: string;
  try {
    rest = decodeURIComponent(m[3]);
  } catch {
    return null;
  }
  if (/[\s\\]|\.\.|\/\//.test(rest)) return null; // whitespace, backslash, traversal, empty segment
  // Drop the file extension: the public id has none.
  const publicId = rest.replace(/\.[A-Za-z0-9]{1,8}$/, '');
  if (!publicId || publicId.split('/').some((seg) => seg.includes(','))) return null; // a transformation
  if (!publicId.split('/').slice(0, -1).includes(userId)) return null;
  return publicId;
}
