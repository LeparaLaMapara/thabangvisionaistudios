import type { StorageProvider } from './types';
import { cloudinary } from './cloudinary';
import { supabaseStorage } from './supabase-storage';
import { s3 } from './s3';

// Re-export types for convenience
export type {
  StorageProvider,
  StorageAsset,
  DeleteResult,
  SignedUploadParams,
} from './types';

// ─── Provider Registry ───────────────────────────────────────────────────────

const providers: Record<string, StorageProvider> = {
  cloudinary,
  'supabase-storage': supabaseStorage,
  s3,
};

// ─── Active Provider ─────────────────────────────────────────────────────────

const providerName = (process.env.STORAGE_PROVIDER ?? 'cloudinary').toLowerCase();

if (!providers[providerName]) {
  console.warn(
    `[storage] Unknown STORAGE_PROVIDER="${providerName}". Falling back to cloudinary. ` +
    `Valid options: ${Object.keys(providers).join(', ')}`,
  );
}

/**
 * The active storage provider, determined by `STORAGE_PROVIDER` env var.
 * Defaults to Cloudinary if not set or unrecognized.
 */
export const storage: StorageProvider = providers[providerName] ?? cloudinary;
