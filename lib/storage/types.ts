// ─── Storage Provider Abstraction ────────────────────────────────────────────

export type StorageAsset = {
  /** Public URL of the uploaded asset */
  url: string;
  /** Provider-specific asset identifier (used for deletion) */
  public_id: string;
};

export type SignedUploadParams = {
  /** Cryptographic signature for client-side upload */
  signature: string;
  /** Unix timestamp used in signing */
  timestamp: string;
  /** Upload endpoint URL */
  uploadUrl: string;
  /** Any additional fields the client must include in the upload form */
  fields: Record<string, string>;
};

export type DeleteResult = {
  success: boolean;
};

/**
 * Unified storage provider interface.
 *
 * Each provider implements these methods. The active provider is
 * selected via `STORAGE_PROVIDER` env var in `lib/storage/index.ts`.
 */
export interface StorageProvider {
  /** Provider identifier (e.g., 'cloudinary', 'supabase-storage', 's3') */
  readonly name: string;

  /** Whether the provider has valid credentials configured. */
  isConfigured(): boolean;

  /**
   * Upload an image/file from the server side.
   *
   * @param file - File buffer or base64 data URI
   * @param folder - Destination folder/path
   * @param resourceType - Asset type: 'image', 'video', or 'raw'
   */
  uploadImage(
    file: Buffer | string,
    folder: string,
    resourceType?: 'image' | 'video' | 'raw',
  ): Promise<StorageAsset>;

  /**
   * Delete a single asset by its public ID.
   *
   * @param publicId - Provider-specific asset identifier
   * @param resourceType - Asset type (default 'image')
   */
  deleteImage(
    publicId: string,
    resourceType?: 'image' | 'video' | 'raw',
  ): Promise<DeleteResult>;

  /**
   * Delete all assets under a folder prefix.
   *
   * @param folder - Folder path/prefix to delete
   */
  deleteFolder(folder: string): Promise<DeleteResult>;

  /**
   * Generate signed parameters for client-side direct upload.
   * The client uses these to upload directly to the provider
   * without the server proxying the file bytes.
   *
   * @param folder - Destination folder
   * @param paramsToSign - Additional params to include in the signature
   */
  getSignedUploadParams(
    folder: string,
    paramsToSign?: Record<string, string>,
  ): Promise<SignedUploadParams>;
}
