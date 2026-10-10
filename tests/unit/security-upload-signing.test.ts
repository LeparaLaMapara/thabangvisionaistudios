/**
 * Phase 6 security INJ-5: /api/cloudinary/sign signed whatever the client
 * sent: any public_id/folder (overwrite another user's asset, write into the
 * reserved listings/clean folder) and raw uploads.
 */
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { STUDIO } from '@/lib/constants';
import { uploadFolderFor, uploadPolicy } from '@/lib/storage/upload-policy';

const ROOT = STUDIO.security.uploads.userRoot;
const UID = '9b1d4c1e-1111-4222-8333-444455556666';

describe('uploadFolderFor', () => {
  it.each([
    ['portfolios', `${ROOT}/${UID}/portfolios`],
    ['gear', `${ROOT}/${UID}/gear`],
    [`profiles/${UID}`, `${ROOT}/${UID}/profiles`],
    [`thabangvision_usecase/media/portfolios/${UID}/p1`, `${ROOT}/${UID}/portfolios/p1`],
    ['thabangvision_usecase/media/listings', `${ROOT}/${UID}/media/listings`],
    // Attacks: another user's folder, the reserved clean folder, traversal.
    ['thabangvision_usecase/media/portfolios/other-user/p1', `${ROOT}/${UID}/other-user/p1`],
    ['thabangvision_usecase/media/listings/clean', `${ROOT}/${UID}/listings/clean`],
    ['../../etc', `${ROOT}/${UID}/etc`],
    ['', `${ROOT}/${UID}/misc`],
    [undefined, `${ROOT}/${UID}/misc`],
  ])('non-admin %s -> %s', (requested, expected) => {
    expect(uploadFolderFor(UID, false, requested)).toBe(expected);
  });

  it('every non-admin folder is inside the user namespace', () => {
    for (const f of ['x', 'a/b/c/d/e', `${ROOT}/someone-else`, 'thabangvision_usecase/media/listings/clean']) {
      expect(uploadFolderFor(UID, false, f).startsWith(`${ROOT}/${UID}/`)).toBe(true);
    }
  });

  it('an admin may name a folder (safe charset only)', () => {
    expect(uploadFolderFor(UID, true, 'thabangvision_usecase/media/smartproductions/portrait')).toBe('thabangvision_usecase/media/smartproductions/portrait');
    expect(uploadFolderFor(UID, true, 'press/../x y')).toBe('press');
  });
});

describe('uploadPolicy', () => {
  it('image by default, video when asked, nothing else', () => {
    expect(uploadPolicy(UID, false, {})?.kind).toBe('image');
    expect(uploadPolicy(UID, false, { resource_type: 'video' })?.params.allowed_formats).toBe('mp4');
    expect(uploadPolicy(UID, false, { resource_type: 'raw' })).toBeNull();
    expect(uploadPolicy(UID, false, { resource_type: 'auto' })).toBeNull();
    const img = uploadPolicy(UID, false, { folder: 'gear' });
    expect(img?.params.allowed_formats.split(',')).not.toContain('svg');
    expect(Object.keys(img?.params ?? {}).sort()).toEqual(['allowed_formats', 'folder', 'timestamp']);
  });
});

// ─── The route ─────────────────────────────────────────────────────────────
let admin = false;
vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ error: null, user: { id: UID, email: 'u@example.com' } }),
  checkRateLimit: async () => true,
  isAdmin: async () => admin,
}));

process.env.CLOUDINARY_CLOUD_NAME = 'unit-cloud';
process.env.CLOUDINARY_API_KEY = '123';
process.env.CLOUDINARY_API_SECRET = 'unit-secret';
process.env.STORAGE_PROVIDER = 'cloudinary';

const { POST } = await import('@/app/api/cloudinary/sign/route');
const sign = (paramsToSign: Record<string, string>) =>
  POST(new NextRequest('http://localhost/api/cloudinary/sign', { method: 'POST', body: JSON.stringify({ paramsToSign }) }));
const sha1 = (params: Record<string, string>) =>
  crypto.createHash('sha1').update(
    Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&') + 'unit-secret',
  ).digest('hex');

describe('POST /api/cloudinary/sign', () => {
  beforeEach(() => { admin = false; });

  it('ignores a client public_id/overwrite/folder and signs only the server policy', async () => {
    const res = await sign({
      folder: 'thabangvision_usecase/media/listings/clean',
      public_id: 'thabangvision_usecase/media/portfolios/victim/p1/photo',
      overwrite: 'true',
      upload_preset: 'unsigned',
      notification_url: 'https://evil.example/hook',
      resource_type: 'image',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { signature: string; folder: string; params: Record<string, string> };
    expect(body.folder).toBe(`${ROOT}/${UID}/listings/clean`);
    expect(Object.keys(body.params).sort()).toEqual(['allowed_formats', 'folder', 'timestamp']);
    // The signature covers exactly the returned params: adding public_id breaks it.
    expect(body.signature).toBe(sha1(body.params));
    expect(body.signature).not.toBe(sha1({ ...body.params, public_id: 'thabangvision_usecase/media/portfolios/victim/p1/photo' }));
  });

  it.each(['raw', 'auto', 'javascript'])('refuses resource_type %s', async (rt) => {
    expect((await sign({ folder: 'x', resource_type: rt })).status).toBe(400);
  });
});

describe('review fix: admin formats and file pickers match the policy', () => {
  it('admins can upload the camera formats the admin tools take; never SVG or raw', async () => {
    const { allowedFormats, uploadPolicy } = await import('@/lib/storage/upload-policy');
    const img = uploadPolicy(UID, true, { folder: 'thabangvision/handovers/x', resource_type: 'image' })!;
    const vid = uploadPolicy(UID, true, { folder: 'x', resource_type: 'video' })!;
    for (const f of ['tiff', 'bmp', 'jpg', 'heic']) expect(img.params.allowed_formats.split(',')).toContain(f);
    for (const f of ['mov', 'webm', 'mp4']) expect(vid.params.allowed_formats.split(',')).toContain(f);
    for (const k of ['image', 'video'] as const) {
      for (const admin of [true, false]) expect(allowedFormats(k, admin)).not.toContain('svg');
    }
    // Non-admins are unchanged.
    expect(uploadPolicy(UID, false, { resource_type: 'video' })!.params.allowed_formats).toBe('mp4');
    expect(uploadPolicy(UID, false, {})!.params.allowed_formats.split(',')).not.toContain('tiff');
    expect(uploadPolicy(UID, true, { resource_type: 'raw' })).toBeNull();
  });

  it('uploadAccept / dropzoneAccept list exactly the allowed formats (mime + extension), never a wildcard', async () => {
    const { allowedFormats, dropzoneAccept, uploadAccept } = await import('@/lib/storage/upload-policy');
    const media = uploadAccept('media', true);
    expect(media).not.toMatch(/\*|svg/);
    for (const f of [...allowedFormats('image', true), ...allowedFormats('video', true)]) expect(media.split(',')).toContain(`.${f}`);
    expect(media).toContain('video/quicktime');
    expect(uploadAccept('image', false)).not.toContain('video/');
    const dz = dropzoneAccept('image', true);
    expect(Object.keys(dz)).not.toContain('image/*');
    expect(dz['image/tiff']).toEqual(['.tif', '.tiff']);
  });

  it('no Cloudinary uploader offers a wildcard picker (image/* would offer SVG)', async () => {
    const fs = await import('node:fs');
    const files = [
      'app/(platform)/dashboard/profile/page.tsx', 'app/(platform)/dashboard/listings/page.tsx',
      'app/(admin)/admin/projects/page.tsx', 'app/(admin)/admin/rentals/[id]/handover/page.tsx',
      'app/(admin)/admin/rentals/[id]/return/page.tsx', 'app/(admin)/admin/rentals/page.tsx',
      'app/(admin)/admin/rentals/import/page.tsx', 'app/(admin)/admin/press/page.tsx',
    ];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/['"](image|video)\/\*['"]/);
    }
  });
});
