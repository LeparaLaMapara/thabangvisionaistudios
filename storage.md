# Storage Abstraction Layer

## Overview

The storage system uses a **provider abstraction** pattern that allows switching between file storage backends (Cloudinary, Supabase Storage, AWS S3) with a single environment variable. All upload, delete, and signing operations go through a unified interface defined in `lib/storage/`.

---

## Architecture

```
lib/storage/
  types.ts              - Shared types and StorageProvider interface
  cloudinary.ts         - Cloudinary adapter (fully implemented)
  supabase-storage.ts   - Supabase Storage adapter (stub)
  s3.ts                 - AWS S3 adapter (stub)
  index.ts              - Provider registry + env-based selection

lib/cloudinary/
  upload.ts             - Client-side upload helpers (XHR with progress)
```

### How Provider Selection Works

```
STORAGE_PROVIDER env var
        |
        v
  index.ts reads env var (defaults to "cloudinary")
        |
        v
  Looks up in providers registry: { cloudinary, supabase-storage, s3 }
        |
        v
  Exports the matched provider as `storage`
```

All API routes import from `@/lib/storage` and call `storage.uploadImage()`, `storage.deleteImage()`, etc. They never reference a specific provider directly.

### Two-Layer Architecture

The storage system has two distinct layers:

**Server-side (`lib/storage/`)** — the abstraction layer. Handles signing, server uploads, and deletions. This is what the API routes use.

**Client-side (`lib/cloudinary/upload.ts`)** — browser-only upload helpers. Uses `XMLHttpRequest` for byte-level progress tracking. Calls `/api/cloudinary/sign` to get a signature, then uploads directly to the storage provider. This avoids proxying large file bytes through the Next.js server.

```
Browser Upload Flow:
  1. Client calls /api/cloudinary/sign (server generates signature via storage.getSignedUploadParams)
  2. Client POSTs file directly to Cloudinary (signed, no server proxy)
  3. Cloudinary returns { secure_url, public_id }
  4. Client saves URL + public_id to Supabase

Server Upload Flow:
  1. Server receives file (Buffer or base64)
  2. Server calls storage.uploadImage(file, folder)
  3. Provider uploads and returns { url, public_id }
```

---

## The StorageProvider Interface

Every provider implements this interface (`lib/storage/types.ts`):

```typescript
interface StorageProvider {
  readonly name: string;

  isConfigured(): boolean;

  uploadImage(
    file: Buffer | string,
    folder: string,
    resourceType?: 'image' | 'video' | 'raw',
  ): Promise<StorageAsset>;

  deleteImage(
    publicId: string,
    resourceType?: 'image' | 'video' | 'raw',
  ): Promise<DeleteResult>;

  deleteFolder(folder: string): Promise<DeleteResult>;

  getSignedUploadParams(
    folder: string,
    paramsToSign?: Record<string, string>,
  ): Promise<SignedUploadParams>;
}
```

### Key Types

| Type | Purpose |
|------|---------|
| `StorageAsset` | Upload result: `{ url: string, public_id: string }` |
| `SignedUploadParams` | Client upload params: `{ signature, timestamp, uploadUrl, fields }` |
| `DeleteResult` | Deletion result: `{ success: boolean }` |

---

## How the Cloudinary Provider Works

### Signature Generation (`getSignedUploadParams`)

Cloudinary uses SHA-256 signatures to authorize uploads without exposing the API secret. The signing algorithm:

1. Collect all parameters to sign (folder, timestamp, any extras)
2. Sort them alphabetically by key
3. Join as `key=value` pairs with `&`
4. Append the API secret (no separator)
5. SHA-256 hash the result

```
Input:  folder=media/press&timestamp=1710000000{API_SECRET}
Output: a3b2c1d4e5f6... (hex SHA-256)
```

The signature, timestamp, upload URL, and public fields (api_key, cloud_name) are returned to the client for direct upload.

### Server-Side Upload (`uploadImage`)

Accepts a `Buffer` (binary file data) or `string` (base64 data URI / remote URL). Signs the request server-side and POSTs to Cloudinary's upload API.

```typescript
// Buffer upload
const asset = await storage.uploadImage(fileBuffer, 'media/press', 'image');
// asset = { url: 'https://res.cloudinary.com/...', public_id: 'media/press/abc123' }

// Base64 upload
const asset = await storage.uploadImage('data:image/jpeg;base64,...', 'media/press');

// Remote URL upload
const asset = await storage.uploadImage('https://example.com/photo.jpg', 'media/press');
```

### Single Asset Deletion (`deleteImage`)

Signs a destroy request with the public_id and sends it to Cloudinary's destroy endpoint. Supports different resource types.

```typescript
await storage.deleteImage('media/press/abc123');                  // default: image
await storage.deleteImage('media/videos/def456', 'video');        // video
await storage.deleteImage('media/documents/ghi789', 'raw');       // raw file
```

### Folder Deletion (`deleteFolder`)

Uses the Cloudinary Admin API with HTTP Basic Auth to delete all assets under a folder prefix. Runs image and video deletions in parallel and invalidates CDN cache.

```typescript
await storage.deleteFolder('thabangvision_usecase/media/smartproductions/wedding');
// Deletes ALL images and videos under that prefix
```

---

## How to Switch Providers

### Step 1: Set the environment variable

In `.env.local`:

```env
# Options: cloudinary, supabase-storage, s3
STORAGE_PROVIDER=cloudinary
```

### Step 2: Add provider credentials

For **Cloudinary**:
```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

For **Supabase Storage** (when implemented):
```env
# Uses existing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
```

For **AWS S3** (when implemented):
```env
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=your_region
AWS_S3_BUCKET=your_bucket_name
```

### Step 3: Restart the dev server

The provider is resolved at module load time. A server restart is required after changing `STORAGE_PROVIDER`.

**Note:** The Supabase Storage and S3 providers are stubs that throw "not implemented" errors. Only Cloudinary is fully functional. The stubs exist to define the extension points for future implementation.

---

## How Routes Use the Abstraction

### POST /api/cloudinary/sign (Signed Upload Params)

Requires authentication. Rate limited to 20 requests/minute per user. Returns signed params for client-side direct upload.

```typescript
import { storage } from '@/lib/storage';

const signed = await storage.getSignedUploadParams(folder, params);

return NextResponse.json({
  signature: signed.signature,
  cloudName: signed.fields.cloud_name,
  apiKey: signed.fields.api_key,
});
```

**Request:**
```json
POST /api/cloudinary/sign
{ "paramsToSign": { "folder": "media/press", "timestamp": "1710000000" } }
```

**Response:**
```json
{ "signature": "a3b2c1d4...", "cloudName": "dzymetqjr", "apiKey": "299338729251248" }
```

### POST /api/cloudinary/delete (Single Asset)

Requires admin access. Deletes one asset by its provider-specific ID.

```typescript
import { storage } from '@/lib/storage';

await storage.deleteImage(public_id, resource_type);
return NextResponse.json({ success: true });
```

**Request:**
```json
POST /api/cloudinary/delete
{ "public_id": "media/press/cover_abc123", "resource_type": "image" }
```

**Response:**
```json
{ "success": true }
```

### POST /api/cloudinary/delete-folder (All Assets in Folder)

Requires admin access. Deletes everything under a folder prefix (images + videos).

```typescript
import { storage } from '@/lib/storage';

await storage.deleteFolder(folder);
return NextResponse.json({ success: true });
```

**Request:**
```json
POST /api/cloudinary/delete-folder
{ "folder": "thabangvision_usecase/media/smartproductions/wedding" }
```

**Response:**
```json
{ "success": true }
```

---

## Client-Side Upload Flow

The client-side upload code lives in `lib/cloudinary/upload.ts` (browser-only, uses XHR). It works alongside the storage abstraction:

### Single File Upload with Progress

```typescript
import { uploadFile } from '@/lib/cloudinary/upload';

const asset = await uploadFile(
  file,                                    // File object from input/dropzone
  'thabangvision_usecase/media/press',     // destination folder
  (pct) => setProgress(pct),               // 0-100 progress callback
);

// asset = { url: 'https://res.cloudinary.com/...', public_id: '...' }
```

**Internal flow:**
1. Generates a timestamp
2. Calls `POST /api/cloudinary/sign` with `{ folder, timestamp }` to get a server-generated signature
3. Builds a `FormData` with file + signed params
4. POSTs directly to Cloudinary via XHR (supports upload progress events)
5. Returns `{ url, public_id }`

### Bulk Upload

```typescript
import { uploadMany } from '@/lib/cloudinary/upload';

const assets = await uploadMany(
  files,                                   // File[] from dropzone
  'thabangvision_usecase/media/gallery',   // shared folder
  (pct) => setProgress(pct),               // 0-100 based on files completed
);
```

Uploads all files in parallel. Progress fires after each individual file completes.

### Folder Path Convention

```typescript
import { smartProductionFolder } from '@/lib/cloudinary/upload';

smartProductionFolder('wedding');    // → 'thabangvision_usecase/media/smartproductions/wedding'
smartProductionFolder('Music Video'); // → 'thabangvision_usecase/media/smartproductions/music-video'
smartProductionFolder();             // → 'thabangvision_usecase/media/smartproductions/general'
```

Standard folder paths used across the platform:

| Content Type | Folder Path |
|-------------|-------------|
| Smart Productions | `thabangvision_usecase/media/smartproductions/{category}` |
| Smart Rentals | `thabangvision_usecase/media/smartrentals/{category}` |
| Press | `thabangvision_usecase/media/press` |
| Marketplace Listings | `thabangvision_usecase/media/marketplace/{user_id}` |
| User Avatars | `thabangvision_usecase/media/avatars` |

---

## Using the Abstraction in Your Own Code

### Server-side upload

```typescript
import { storage } from '@/lib/storage';

// Upload a buffer (e.g., from a form submission)
const asset = await storage.uploadImage(buffer, 'media/avatars', 'image');
console.log(asset.url);        // https://res.cloudinary.com/...
console.log(asset.public_id);  // media/avatars/abc123

// Save to Supabase
await supabase.from('profiles').update({
  avatar_url: asset.url,
  avatar_public_id: asset.public_id,
}).eq('id', userId);
```

### Server-side delete

```typescript
import { storage } from '@/lib/storage';

// Delete the old avatar before uploading a new one
if (profile.avatar_public_id) {
  await storage.deleteImage(profile.avatar_public_id);
}
```

### Check if configured

```typescript
import { storage } from '@/lib/storage';

if (!storage.isConfigured()) {
  return NextResponse.json(
    { error: 'Storage provider is not configured.' },
    { status: 500 },
  );
}
```

---

## Adding a New Provider

1. Create `lib/storage/newprovider.ts` implementing the `StorageProvider` interface:
   ```typescript
   import type { StorageProvider, StorageAsset, DeleteResult, SignedUploadParams } from './types';

   export const newprovider: StorageProvider = {
     name: 'newprovider',

     isConfigured() {
       return !!process.env.NEWPROVIDER_API_KEY;
     },

     async uploadImage(file, folder, resourceType): Promise<StorageAsset> {
       // Upload to provider, return { url, public_id }
     },

     async deleteImage(publicId, resourceType): Promise<DeleteResult> {
       // Delete from provider, return { success: true }
     },

     async deleteFolder(folder): Promise<DeleteResult> {
       // Delete all assets under prefix, return { success: true }
     },

     async getSignedUploadParams(folder, paramsToSign): Promise<SignedUploadParams> {
       // Generate signed params for client-side upload
       return { signature, timestamp, uploadUrl, fields };
     },
   };
   ```

2. Register it in `lib/storage/index.ts`:
   ```typescript
   import { newprovider } from './newprovider';

   const providers: Record<string, StorageProvider> = {
     cloudinary,
     'supabase-storage': supabaseStorage,
     s3,
     newprovider,
   };
   ```

3. Set `STORAGE_PROVIDER=newprovider` in `.env.local`

4. If the provider uses a different client-side upload pattern, you may also need to update `lib/cloudinary/upload.ts` or create a new client-side upload module.

---

## Security

- **API secrets are server-side only** — `CLOUDINARY_API_SECRET` never leaves the server
- **Signed uploads** — clients can only upload with a server-generated signature (SHA-256)
- **Auth required** — signing requires authentication (`requireAuth()`)
- **Admin-only deletions** — delete routes require admin access (`requireAdmin()`)
- **Rate limiting** — upload signing is limited to 20 requests/minute per user
- **Resource type validation** — only `image`, `video`, and `raw` are allowed
- **CDN invalidation** — folder deletions include `invalidate=true` to clear cached assets

---

## Provider Status

| Provider | Status | Notes |
|----------|--------|-------|
| Cloudinary | Fully implemented | All 4 methods working. Production-ready. |
| Supabase Storage | Stub | Throws "not implemented". Uses existing Supabase credentials when built. |
| AWS S3 | Stub | Throws "not implemented". Will need @aws-sdk/client-s3 package. |

---

## Where to Get Credentials

### Cloudinary

1. Go to [cloudinary.com](https://cloudinary.com)
2. Sign up for a free account (25GB storage, 25GB bandwidth/month)
3. After registration, find your credentials on the **Dashboard**:
   - **Cloud Name** — displayed at the top (e.g., `dzymetqjr`)
   - **API Key** — numeric key (safe to expose to clients for signed uploads)
   - **API Secret** — secret key (server-only, never expose)

```env
CLOUDINARY_CLOUD_NAME=dzymetqjr
CLOUDINARY_API_KEY=299338729251248
CLOUDINARY_API_SECRET=your_secret_here
```

### General

```env
# Which provider to use (default: cloudinary)
STORAGE_PROVIDER=cloudinary
```

---

## Files Modified by This Abstraction

| File | Change |
|------|--------|
| `lib/storage/types.ts` | Created - shared interface and types |
| `lib/storage/cloudinary.ts` | Created - full Cloudinary implementation (sign, upload, delete, folder delete) |
| `lib/storage/supabase-storage.ts` | Created - stub (throws not implemented) |
| `lib/storage/s3.ts` | Created - stub (throws not implemented) |
| `lib/storage/index.ts` | Created - provider registry and env-based selection |
| `app/api/cloudinary/sign/route.ts` | Updated - uses `storage.getSignedUploadParams()` |
| `app/api/cloudinary/delete/route.ts` | Updated - uses `storage.deleteImage()` |
| `app/api/cloudinary/delete-folder/route.ts` | Updated - uses `storage.deleteFolder()` |
| `.env.local` | Updated - added `STORAGE_PROVIDER` variable |

**Unchanged:** `lib/cloudinary/upload.ts` — client-side upload helpers remain as-is. They call `/api/cloudinary/sign` which now delegates to the storage abstraction internally.
