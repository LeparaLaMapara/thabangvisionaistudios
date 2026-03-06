/**
 * Cloudinary upload helpers — client-side only.
 *
 * Flow:
 *   1. Get a signed upload params from /api/cloudinary/sign  (keeps API_SECRET on server)
 *   2. POST file directly to Cloudinary's upload endpoint
 *   3. Return { url, public_id } for storage in Supabase
 *
 * Never import this from a Server Component — it uses fetch + XMLHttpRequest.
 */

export type CloudinaryAsset = {
  url: string;
  public_id: string;
};

// ─── Signature ───────────────────────────────────────────────────────────────

type SignResponse = {
  signature: string;
  cloudName: string;
  apiKey: string;
};

async function getSignature(
  paramsToSign: Record<string, string>,
): Promise<SignResponse> {
  const res = await fetch('/api/cloudinary/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paramsToSign }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Signature request failed (${res.status}): ${body}`);
  }
  return res.json();
}

// ─── Single upload ────────────────────────────────────────────────────────────

/**
 * Upload a single File to Cloudinary.
 *
 * Uses XMLHttpRequest so the caller can track byte-level progress.
 *
 * @param file      The File to upload.
 * @param folder    Cloudinary folder path, e.g. "thabangvision_usecase/media/smartproductions/portrait"
 * @param onProgress  Optional callback, called with 0–100 as bytes are sent.
 */
export function uploadFile(
  file: File,
  folder: string,
  onProgress?: (pct: number) => void,
): Promise<CloudinaryAsset> {
  return new Promise((resolve, reject) => {
    const timestamp = Math.round(Date.now() / 1000).toString();
    const paramsToSign: Record<string, string> = { folder, timestamp };

    getSignature(paramsToSign)
      .then(({ signature, cloudName, apiKey }) => {
        const fd = new FormData();
        fd.append('file',      file);
        fd.append('folder',    folder);
        fd.append('timestamp', timestamp);
        fd.append('api_key',   apiKey);
        fd.append('signature', signature);

        const xhr = new XMLHttpRequest();
        // auto/upload handles images, videos, and raw files
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`);

        if (onProgress) {
          xhr.upload.addEventListener('progress', e => {
            if (e.lengthComputable) {
              onProgress(Math.round((e.loaded / e.total) * 100));
            }
          });
        }

        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            const data = JSON.parse(xhr.responseText) as {
              secure_url: string;
              public_id: string;
            };
            resolve({ url: data.secure_url, public_id: data.public_id });
          } else {
            // Cloudinary error bodies are JSON
            let msg = `Upload failed (${xhr.status})`;
            try {
              const err = JSON.parse(xhr.responseText) as { error?: { message?: string } };
              if (err.error?.message) msg = err.error.message;
            } catch { /* ignore parse error */ }
            reject(new Error(msg));
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Upload network error')));
        xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

        xhr.send(fd);
      })
      .catch(reject);
  });
}

// ─── Bulk upload ──────────────────────────────────────────────────────────────

/**
 * Upload multiple Files to Cloudinary in parallel.
 *
 * onProgress fires after each file completes (0–100 based on file count, not bytes).
 *
 * @param files      Array of Files to upload.
 * @param folder     Shared Cloudinary folder for all files.
 * @param onProgress Optional callback, 0–100 based on files completed.
 */
export async function uploadMany(
  files: File[],
  folder: string,
  onProgress?: (pct: number) => void,
): Promise<CloudinaryAsset[]> {
  if (files.length === 0) return [];

  let done = 0;

  const results = await Promise.all(
    files.map(file =>
      uploadFile(file, folder).then(asset => {
        done++;
        onProgress?.(Math.round((done / files.length) * 100));
        return asset;
      }),
    ),
  );

  return results;
}

// ─── Folder builder ───────────────────────────────────────────────────────────

/**
 * Build the canonical Cloudinary folder for a Smart Production.
 *
 * Convention:  thabangvision_usecase/media/smartproductions/{category}
 */
export function smartProductionFolder(subCategory?: string | null): string {
  const category = subCategory?.trim().toLowerCase().replace(/\s+/g, '-') || 'general';
  return `thabangvision_usecase/media/smartproductions/${category}`;
}
