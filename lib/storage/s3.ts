import type { StorageProvider } from './types';

// ─── AWS S3 Provider (stub) ──────────────────────────────────────────────────

const NOT_IMPLEMENTED = 'S3 storage provider is not yet implemented. Set STORAGE_PROVIDER=cloudinary to use the working provider.';

export const s3: StorageProvider = {
  name: 's3',

  isConfigured(): boolean {
    return false;
  },

  async uploadImage(): Promise<never> {
    throw new Error(NOT_IMPLEMENTED);
  },

  async deleteImage(): Promise<never> {
    throw new Error(NOT_IMPLEMENTED);
  },

  async deleteFolder(): Promise<never> {
    throw new Error(NOT_IMPLEMENTED);
  },

  async getSignedUploadParams(): Promise<never> {
    throw new Error(NOT_IMPLEMENTED);
  },
};
