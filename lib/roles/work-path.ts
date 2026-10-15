import crypto from 'node:crypto';
import { STUDIO } from '@/lib/constants';
import type { StorageAsset, StorageProvider } from '@/lib/storage/types';

/**
 * Where People work lives once it is filed as proof (security M1b).
 *
 * The browser uploads into the person's own folder (<userRoot>/<user id>/...),
 * which is how the server knows the file is theirs (lib/roles/own-upload.ts).
 * That folder name is the person's user id, and a work photo's URL is shown
 * on the blind /people page, so anyone could read the id off <img src> and
 * look the person up. When the proof is filed, the server moves the asset to
 * <roleWorkRoot>/<person_role id>/<random>: no user id in the public URL.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export function roleWorkFolder(personRoleId: string): string {
  return `${STUDIO.security.uploads.roleWorkRoot}/${personRoleId}`;
}

/** A fresh, unguessable id for one work file of this profile. */
export function newRoleWorkPublicId(personRoleId: string): string {
  return `${roleWorkFolder(personRoleId)}/${crypto.randomBytes(12).toString('hex')}`;
}

/** True when this public id or URL still sits in a user's own (uuid-named) folder. */
export function carriesUserId(publicIdOrUrl: string | null | undefined): boolean {
  if (!publicIdOrUrl) return false;
  return new RegExp(`(^|/)${STUDIO.security.uploads.userRoot.split('/').pop()}/${UUID}/`, 'i').test(publicIdOrUrl);
}

/** image or video, read from a delivery URL (/<cloud>/<type>/upload/...). */
export function resourceTypeOfUrl(url: string | null | undefined): 'image' | 'video' | 'raw' {
  const m = /\/(image|video|raw)\/upload\//.exec(url ?? '');
  return (m?.[1] as 'image' | 'video' | 'raw' | undefined) ?? 'image';
}

/**
 * Move one uploaded work file to the profile's folder. Throws if the
 * provider cannot move it, so the caller never stores a URL with a user id.
 */
export async function moveToRoleWork(
  storage: Pick<StorageProvider, 'renameAsset' | 'name'>,
  publicId: string,
  personRoleId: string,
  resourceType: 'image' | 'video' | 'raw',
): Promise<StorageAsset> {
  if (!storage.renameAsset) throw new Error(`[roles/work-path] ${storage.name} cannot move assets`);
  return storage.renameAsset(publicId, newRoleWorkPublicId(personRoleId), resourceType);
}
