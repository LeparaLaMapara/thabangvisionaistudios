import type { StorageProvider } from './types';

// ─── Supabase Storage Provider (stub) ────────────────────────────────────────

const NOT_IMPLEMENTED = 'Supabase Storage provider is not yet implemented. Set STORAGE_PROVIDER=cloudinary to use the working provider.';

export const supabaseStorage: StorageProvider = {
  name: 'supabase-storage',

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
