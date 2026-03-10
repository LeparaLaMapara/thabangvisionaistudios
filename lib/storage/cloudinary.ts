import crypto from 'node:crypto';
import type {
  StorageProvider,
  StorageAsset,
  DeleteResult,
  SignedUploadParams,
} from './types';

// ─── Cloudinary Provider ─────────────────────────────────────────────────────

function getConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary credentials are not configured');
  }
  return { cloudName, apiKey, apiSecret };
}

function sign(params: Record<string, string>, secret: string): string {
  const toSign =
    Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&') + secret;
  return crypto.createHash('sha256').update(toSign).digest('hex');
}

export const cloudinary: StorageProvider = {
  name: 'cloudinary',

  isConfigured(): boolean {
    return !!(
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    );
  },

  async uploadImage(
    file: Buffer | string,
    folder: string,
    resourceType: 'image' | 'video' | 'raw' = 'image',
  ): Promise<StorageAsset> {
    const { cloudName, apiKey, apiSecret } = getConfig();
    const timestamp = Math.round(Date.now() / 1000).toString();

    const paramsToSign: Record<string, string> = { folder, timestamp };
    const signature = sign(paramsToSign, apiSecret);

    const formData = new FormData();

    if (Buffer.isBuffer(file)) {
      formData.append('file', new Blob([new Uint8Array(file)]));
    } else {
      // base64 data URI or remote URL
      formData.append('file', file);
    }

    formData.append('folder', folder);
    formData.append('timestamp', timestamp);
    formData.append('api_key', apiKey);
    formData.append('signature', signature);

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
      { method: 'POST', body: formData },
    );

    if (!res.ok) {
      const data = (await res.json()) as { error?: { message?: string } };
      throw new Error(data.error?.message ?? `Upload failed (${res.status})`);
    }

    const data = (await res.json()) as {
      secure_url: string;
      public_id: string;
    };

    return { url: data.secure_url, public_id: data.public_id };
  },

  async deleteImage(
    publicId: string,
    resourceType: 'image' | 'video' | 'raw' = 'image',
  ): Promise<DeleteResult> {
    const { cloudName, apiKey, apiSecret } = getConfig();
    const timestamp = Math.round(Date.now() / 1000).toString();

    const paramsToSign: Record<string, string> = {
      public_id: publicId,
      timestamp,
    };
    const signature = sign(paramsToSign, apiSecret);

    const form = new URLSearchParams({
      public_id: publicId,
      signature,
      api_key: apiKey,
      timestamp,
    });

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      },
    );

    const data = (await res.json()) as {
      result?: string;
      error?: { message: string };
    };

    if (!res.ok || (data.result && data.result !== 'ok')) {
      const msg = data.error?.message ?? `Unexpected result: ${data.result}`;
      throw new Error(msg);
    }

    return { success: true };
  },

  async deleteFolder(folder: string): Promise<DeleteResult> {
    const { cloudName, apiKey, apiSecret } = getConfig();
    const basicAuth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
    const baseUrl = `https://api.cloudinary.com/v1_1/${cloudName}`;
    const headers = { Authorization: `Basic ${basicAuth}` };

    const resourceTypes = ['image', 'video'] as const;

    await Promise.all(
      resourceTypes.map(async (rt) => {
        const url = `${baseUrl}/resources/${rt}/upload?prefix=${encodeURIComponent(folder)}&invalidate=true`;
        const res = await fetch(url, { method: 'DELETE', headers });

        if (!res.ok) {
          const data = (await res.json()) as {
            error?: { message: string };
          };
          throw new Error(
            data.error?.message ?? `Delete failed for ${rt} (${res.status})`,
          );
        }
      }),
    );

    return { success: true };
  },

  async getSignedUploadParams(
    folder: string,
    extraParams?: Record<string, string>,
  ): Promise<SignedUploadParams> {
    const { cloudName, apiKey, apiSecret } = getConfig();
    const timestamp = Math.round(Date.now() / 1000).toString();

    const paramsToSign: Record<string, string> = {
      folder,
      timestamp,
      ...extraParams,
    };
    const signature = sign(paramsToSign, apiSecret);

    return {
      signature,
      timestamp,
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
      fields: {
        api_key: apiKey,
        cloud_name: cloudName,
        folder,
        timestamp,
      },
    };
  },
};
