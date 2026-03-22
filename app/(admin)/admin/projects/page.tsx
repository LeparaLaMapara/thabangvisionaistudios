'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Camera, Crop, Eye, EyeOff, ImagePlus, Images, Loader2,
  Pencil, Plus, RefreshCw, Star, Trash2, X,
} from 'lucide-react';
import exifr from 'exifr';
import type { ImageMetadata } from '@/lib/metadata/extract';

import {
  uploadFile,
  smartProductionFolder,
  type CloudinaryAsset,
} from '@/lib/cloudinary/upload';

// ─── Types ───────────────────────────────────────────────────────────────────

type GalleryItem = CloudinaryAsset; // { url; public_id }

type MetadataEntry = { url: string } & ImageMetadata;

type Production = {
  id: string;
  title: string;
  slug: string;
  client: string | null;
  year: number | null;
  project_type: string;
  sub_category: string | null;
  description: string | null;
  video_provider: string | null;
  video_url: string | null;
  tags: string[] | null;
  thumbnail_url: string | null;
  cover_public_id: string | null;
  gallery: GalleryItem[] | null;
  image_metadata: MetadataEntry[] | null;
  is_published: boolean;
  is_featured: boolean;
  created_at: string;
  deleted_at: string | null;
};

type Form = {
  title: string;
  slug: string;
  client: string;
  project_type: string;
  sub_category: string;
  description: string;
  video_provider: string;
  video_url: string;
  tags: string;
  thumbnail_url: string;
  cover_public_id: string;
  gallery: GalleryItem[];
  image_metadata: MetadataEntry[];
  is_published: boolean;
  is_featured: boolean;
};

const EMPTY_FORM: Form = {
  title: '',
  slug: '',
  client: '',
  project_type: 'film',
  sub_category: '',
  description: '',
  video_provider: '',
  video_url: '',
  tags: '',
  thumbnail_url: '',
  cover_public_id: '',
  gallery: [],
  image_metadata: [],
  is_published: false,
  is_featured: false,
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Canvas-crops an image to the given pixel rect and returns it as a JPEG File.
 * Used so the cropped image is what actually gets uploaded — no DB column needed.
 */
async function getCroppedImg(
  imageSrc: string,
  pixelCrop: Area,
): Promise<File> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    image.onload  = () => resolve();
    image.onerror = reject;
    image.src = imageSrc;
  });

  const canvas = document.createElement('canvas');
  canvas.width  = pixelCrop.width;
  canvas.height = pixelCrop.height;
  const ctx = canvas.getContext('2d')!;

  ctx.drawImage(
    image,
    pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
    0, 0, pixelCrop.width, pixelCrop.height,
  );

  return new Promise<File>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error('Canvas crop failed')); return; }
      resolve(new File([blob], 'thumbnail.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  });
}

function autoSlug(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/**
 * Extract EXIF metadata from a File object client-side (before Cloudinary upload).
 * Uses exifr which works in both browser and Node.
 */
async function extractExifFromFile(file: File): Promise<ImageMetadata> {
  try {
    // Only process image files
    if (!file.type.startsWith('image/')) return {};
    const buffer = await file.arrayBuffer();
    const exif = await exifr.parse(buffer, {
      pick: [
        'Make', 'Model', 'LensModel', 'FocalLength',
        'FNumber', 'ISO', 'ExposureTime', 'DateTimeOriginal',
        'ImageWidth', 'ImageHeight', 'Software',
      ],
    });
    if (!exif) return {};
    return {
      camera: exif.Make && exif.Model
        ? `${exif.Make} ${exif.Model}`.replace(/\s+/g, ' ').trim()
        : undefined,
      lens: exif.LensModel || undefined,
      focalLength: exif.FocalLength || undefined,
      aperture: exif.FNumber || undefined,
      iso: exif.ISO || undefined,
      shutterSpeed: exif.ExposureTime
        ? exif.ExposureTime >= 1
          ? `${exif.ExposureTime}s`
          : `1/${Math.round(1 / exif.ExposureTime)}s`
        : undefined,
      dateTaken: exif.DateTimeOriginal
        ? new Date(exif.DateTimeOriginal).toISOString()
        : undefined,
      width: exif.ImageWidth || undefined,
      height: exif.ImageHeight || undefined,
      software: exif.Software || undefined,
    };
  } catch {
    return {};
  }
}

function formToPayload(f: Form, existingYear?: number | null) {
  return {
    title:           f.title.trim(),
    slug:            f.slug.trim(),
    client:          f.client.trim()       || null,
    year:            existingYear ?? new Date().getFullYear(),
    project_type:    f.project_type,
    sub_category:    f.sub_category.trim() || null,
    description:     f.description.trim()  || null,
    video_provider:  f.video_provider      || null,
    video_url:       f.video_url.trim()    || null,
    tags:            f.tags.trim()
      ? f.tags.split(',').map(t => t.trim()).filter(Boolean)
      : null,
    thumbnail_url:   f.thumbnail_url   || null,
    cover_public_id: f.cover_public_id || null,
    gallery:         f.gallery.length > 0 ? f.gallery : null,
    image_metadata:  f.image_metadata.length > 0 ? f.image_metadata : null,
    is_published:    f.is_published,
    is_featured:     f.is_featured,
  };
}

function productionToForm(p: Production): Form {
  return {
    title:           p.title,
    slug:            p.slug,
    client:          p.client          ?? '',
    project_type:    p.project_type,
    sub_category:    p.sub_category    ?? '',
    description:     p.description     ?? '',
    video_provider:  p.video_provider  ?? '',
    video_url:       p.video_url       ?? '',
    tags:            (p.tags ?? []).join(', '),
    thumbnail_url:   p.thumbnail_url   ?? '',
    cover_public_id: p.cover_public_id ?? '',
    gallery:         p.gallery         ?? [],
    image_metadata:  p.image_metadata  ?? [],
    is_published:    p.is_published,
    is_featured:     p.is_featured,
  };
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AdminProjectsPage() {
  // List state
  const [items,      setItems]      = useState<Production[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Form state
  const [showForm,   setShowForm]   = useState(false);
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [form,       setForm]       = useState<Form>(EMPTY_FORM);
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState<string | null>(null);

  // Upload state
  const [thumbUploading, setThumbUploading] = useState(false);
  const [thumbPct,       setThumbPct]       = useState(0);
  const [galUploading,   setGalUploading]   = useState(false);
  const [galPct,         setGalPct]         = useState(0);
  const [galUploaded,    setGalUploaded]    = useState(0);
  const [galTotal,       setGalTotal]       = useState(0);

  // EXIF metadata extraction
  const [extracting, setExtracting] = useState(false);

  // Row-level action state
  const [togglingId,   setTogglingId]   = useState<string | null>(null);
  const [confirmId,    setConfirmId]    = useState<string | null>(null);
  const [deletingId,   setDeletingId]   = useState<string | null>(null);
  const [deleteError,  setDeleteError]  = useState<string | null>(null);

  // Per-media-item delete state (gallery tiles + thumbnail)
  // confirmMedia: public_id of tile awaiting confirmation, or 'thumbnail'
  // deletingMedia: set of public_ids (or 'thumbnail') currently being deleted
  const [confirmMedia,  setConfirmMedia]  = useState<string | null>(null);
  const [deletingMedia, setDeletingMedia] = useState<Set<string>>(new Set());

  // Crop modal state
  // cropSourceUrl: original (pre-crop) image URL fed to the Cropper
  const [showCropModal,     setShowCropModal]     = useState(false);
  const [cropSourceUrl,     setCropSourceUrl]     = useState<string | null>(null);
  const [cropperCrop,       setCropperCrop]       = useState({ x: 0, y: 0 });
  const [cropperZoom,       setCropperZoom]       = useState(1);
  const [pendingCropPixels, setPendingCropPixels] = useState<Area | null>(null);

  // File input refs (reset after upload)
  const thumbInputRef = useRef<HTMLInputElement>(null);
  const galInputRef   = useRef<HTMLInputElement>(null);

  // Live form ref — assigned synchronously on every render so async handlers
  // (save, upload callbacks) always read the committed, up-to-date form state
  // regardless of React's render-scheduling timing.
  const formRef = useRef<Form>(form);
  formRef.current = form;

  const isUploading = thumbUploading || galUploading;

  // ── Fetch ───────────────────────────────────────────────────────────────────

  const load = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/admin/productions');
      if (!res.ok) throw new Error('Failed to fetch productions');
      const data = await res.json();
      setItems((data as Production[]) ?? []);
    } catch (err) {
      setFetchError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // ── Form helpers ────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (item: Production) => {
    setEditingId(item.id);
    setForm(productionToForm(item));
    setFormError(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  };

  const setF = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm(f => ({ ...f, [key]: value }));

  const handleTitleChange = (v: string) =>
    setForm(f => ({ ...f, title: v, slug: editingId ? f.slug : autoSlug(v) }));

  // ── Upload helpers ───────────────────────────────────────────────────────────
  // Shared logic called by both the file-input fallback buttons and the dropzones.
  // Uses formRef.current so the folder always reflects the latest sub_category.

  const doThumbnailUpload = async (file: File) => {
    const folder = smartProductionFolder(formRef.current.sub_category);
    setThumbUploading(true);
    setThumbPct(0);
    setFormError(null);
    try {
      const asset = await uploadFile(file, folder, pct => setThumbPct(pct));
      setForm(f => ({ ...f, thumbnail_url: asset.url, cover_public_id: asset.public_id }));
      // Auto-open crop modal so the user can frame the 3:2 crop immediately.
      setCropSourceUrl(asset.url);
      setCropperCrop({ x: 0, y: 0 });
      setCropperZoom(1);
      setPendingCropPixels(null);
      setShowCropModal(true);
    } catch (err) {
      setFormError(`Thumbnail upload failed: ${(err as Error).message}`);
    } finally {
      setThumbUploading(false);
      if (thumbInputRef.current) thumbInputRef.current.value = '';
    }
  };

  const doGalleryUpload = async (files: File[]) => {
    if (files.length === 0) return;
    const folder = smartProductionFolder(formRef.current.sub_category);
    setGalUploading(true);
    setGalPct(0);
    setGalUploaded(0);
    setGalTotal(files.length);
    setFormError(null);
    try {
      let done = 0;
      // Upload to Cloudinary AND extract EXIF from original files in parallel
      const results = await Promise.all(
        files.map(async (file) => {
          const [asset, exif] = await Promise.all([
            uploadFile(file, folder),
            extractExifFromFile(file),
          ]);
          done++;
          setGalUploaded(done);
          setGalPct(Math.round((done / files.length) * 100));
          return { asset, exif };
        }),
      );

      const assets = results.map(r => r.asset);
      // Build metadata entries for images that have EXIF data
      const newMeta: MetadataEntry[] = results
        .filter(r => r.exif.camera || r.exif.lens || r.exif.iso)
        .map(r => ({ url: r.asset.url, ...r.exif }));

      setForm(prev => ({
        ...prev,
        gallery: [...prev.gallery, ...assets],
        image_metadata: [...prev.image_metadata, ...newMeta],
      }));
    } catch (err) {
      setFormError(`Gallery upload failed: ${(err as Error).message}`);
    } finally {
      setGalUploading(false);
      if (galInputRef.current) galInputRef.current.value = '';
    }
  };

  // ── EXIF metadata extraction ────────────────────────────────────────────────

  const doExtractMetadata = async () => {
    const f = formRef.current;
    const imageUrls = f.gallery
      .map(g => g.url)
      .filter(url => !url.includes('/video/'));

    if (imageUrls.length === 0) {
      setFormError('No images in gallery to extract metadata from.');
      return;
    }

    setExtracting(true);
    setFormError(null);

    try {
      const res = await fetch('/api/admin/extract-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrls }),
      });

      if (!res.ok) throw new Error('Extraction failed.');

      const results: { url: string; metadata: ImageMetadata }[] = await res.json();

      // Filter out entries with no useful data
      const entries: MetadataEntry[] = results
        .filter(r => r.metadata.camera || r.metadata.lens || r.metadata.iso)
        .map(r => ({ url: r.url, ...r.metadata }));

      setForm(prev => ({ ...prev, image_metadata: entries }));

      if (entries.length === 0) {
        setFormError('No EXIF data found. Images may have been stripped of metadata.');
      }
    } catch (err) {
      setFormError(`Metadata extraction failed: ${(err as Error).message}`);
    } finally {
      setExtracting(false);
    }
  };

  // Fallback file-input handlers (label buttons kept alongside dropzones)
  const handleThumbnailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void doThumbnailUpload(file);
  };

  const handleGalleryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void doGalleryUpload(Array.from(e.target.files ?? []));
  };

  // ── Dropzone hooks ───────────────────────────────────────────────────────────

  const thumbDropzone = useDropzone({
    accept:   { 'image/*': [] },
    multiple: false,
    disabled: thumbUploading,
    onDrop:   (accepted) => { if (accepted[0]) void doThumbnailUpload(accepted[0]); },
  });

  const galDropzone = useDropzone({
    accept:   { 'image/*': [], 'video/*': [] },
    multiple: true,
    disabled: galUploading,
    onDrop:   (accepted) => { void doGalleryUpload(accepted); },
  });

  // ── Media delete helpers ────────────────────────────────────────────────────

  // Derive Cloudinary resource_type from the asset URL so we don't need to
  // store it separately alongside { url, public_id }.
  const resourceTypeFromUrl = (url: string): 'image' | 'video' | 'raw' => {
    if (url.includes('/video/')) return 'video';
    if (url.includes('/raw/'))   return 'raw';
    return 'image';
  };

  // Call the server-side delete route (keeps API_SECRET off the client).
  const callCloudinaryDelete = async (public_id: string, url: string) => {
    const res = await fetch('/api/cloudinary/delete', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        public_id,
        resource_type: resourceTypeFromUrl(url),
      }),
    });
    const json = await res.json() as { success?: boolean; error?: string };
    if (!res.ok || !json.success) throw new Error(json.error ?? 'Cloudinary delete failed');
  };

  // Update Supabase gallery column for the currently edited project.
  const syncGalleryToSupabase = async (projectId: string, gallery: GalleryItem[]) => {
    const res = await fetch('/api/admin/productions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: projectId, gallery: gallery.length > 0 ? gallery : null }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(`DB sync failed: ${err.error ?? 'Unknown error'}`);
    }
  };

  /**
   * Delete a gallery item:
   *   1. Optimistic UI remove
   *   2. Cloudinary destroy
   *   3. If editing an existing project → sync Supabase
   *   4. Restore + show error on any failure
   */
  const deleteGalleryItem = async (item: GalleryItem) => {
    const { public_id, url } = item;
    setConfirmMedia(null);

    // Optimistic remove
    setForm(f => ({ ...f, gallery: f.gallery.filter(g => g.public_id !== public_id) }));
    setDeletingMedia(prev => new Set(prev).add(public_id));

    try {
      await callCloudinaryDelete(public_id, url);
      console.log('🗑️ Cloudinary delete OK:', public_id);

      // Sync Supabase only for an existing saved project
      if (editingId) {
        const updatedGallery = formRef.current.gallery; // already has item removed
        await syncGalleryToSupabase(editingId, updatedGallery);
        console.log('✅ Gallery synced to Supabase');
      }
    } catch (err) {
      console.error('❌ Gallery delete error:', err);
      // Restore the item on failure
      setForm(f => ({ ...f, gallery: [...f.gallery, item] }));
      setFormError(`Delete failed: ${(err as Error).message}`);
    } finally {
      setDeletingMedia(prev => {
        const s = new Set(prev);
        s.delete(public_id);
        return s;
      });
    }
  };

  /**
   * Delete the thumbnail:
   *   1. Cloudinary destroy (if cover_public_id is set)
   *   2. Clear from form state
   *   3. If editing an existing project → null-out Supabase columns
   */
  const deleteThumbnail = async () => {
    const { thumbnail_url, cover_public_id } = formRef.current;
    setConfirmMedia(null);

    if (!cover_public_id) {
      // Uploaded file not yet saved — just clear local state
      setForm(f => ({ ...f, thumbnail_url: '', cover_public_id: '' }));
      return;
    }

    setDeletingMedia(prev => new Set(prev).add('thumbnail'));

    try {
      await callCloudinaryDelete(cover_public_id, thumbnail_url);
      console.log('🗑️ Cloudinary thumbnail delete OK:', cover_public_id);

      setForm(f => ({ ...f, thumbnail_url: '', cover_public_id: '' }));

      if (editingId) {
        const res = await fetch('/api/admin/productions', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingId, thumbnail_url: null, cover_public_id: null }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(`DB sync failed: ${err.error ?? 'Unknown error'}`);
        }
        console.log('✅ Thumbnail nulled in Supabase');
      }
    } catch (err) {
      console.error('❌ Thumbnail delete error:', err);
      setFormError(`Thumbnail delete failed: ${(err as Error).message}`);
    } finally {
      setDeletingMedia(prev => {
        const s = new Set(prev);
        s.delete('thumbnail');
        return s;
      });
    }
  };

  // ── Crop modal handlers ──────────────────────────────────────────────────────

  const onCropComplete = useCallback((_: Area, croppedAreaPixels: Area) => {
    setPendingCropPixels(croppedAreaPixels);
  }, []);

  /**
   * "Apply Crop":
   *   1. Canvas-crop the source image to the selected rect.
   *   2. Delete the old Cloudinary asset (silent fail — don't block on it).
   *   3. Upload the cropped JPEG as the new thumbnail.
   *   4. Update form with the new URL + public_id, close modal.
   */
  const applyCropFromModal = async () => {
    if (!cropSourceUrl || !pendingCropPixels) return;
    setShowCropModal(false);
    setThumbUploading(true);
    setThumbPct(0);
    setFormError(null);
    try {
      const croppedFile = await getCroppedImg(cropSourceUrl, pendingCropPixels);

      // Best-effort delete of the previous asset — ignore errors.
      const { cover_public_id: oldId, thumbnail_url: oldUrl } = formRef.current;
      if (oldId && oldUrl) {
        try { await callCloudinaryDelete(oldId, oldUrl); } catch { /* ignored */ }
      }

      const folder = smartProductionFolder(formRef.current.sub_category);
      const asset  = await uploadFile(croppedFile, folder, pct => setThumbPct(pct));
      setForm(f => ({ ...f, thumbnail_url: asset.url, cover_public_id: asset.public_id }));
    } catch (err) {
      setFormError(`Crop upload failed: ${(err as Error).message}`);
    } finally {
      setThumbUploading(false);
    }
  };

  const skipCrop = () => setShowCropModal(false);

  // Re-open the crop modal for an already-uploaded thumbnail.
  const openReCrop = () => {
    const url = formRef.current.thumbnail_url;
    if (!url) return;
    setCropSourceUrl(url);
    setCropperCrop({ x: 0, y: 0 });
    setCropperZoom(1);
    setPendingCropPixels(null);
    setShowCropModal(true);
  };

  // ── Save ────────────────────────────────────────────────────────────────────

  const save = async () => {
    // Always read from the live ref — guaranteed to be the committed form state
    // even if React hasn't flushed the latest render to the closure yet.
    const f = formRef.current;

    if (!f.title.trim()) { setFormError('Title is required.'); return; }
    if (!f.slug.trim())  { setFormError('Slug is required.');  return; }

    setSaving(true);
    setFormError(null);

    const existingYear = editingId ? (items.find(p => p.id === editingId)?.year ?? null) : null;
    const payload      = formToPayload(f, existingYear);

    // Debug: confirm media fields are present before writing
    console.log('💾 Saving payload:', {
      title:           payload.title,
      thumbnail_url:   payload.thumbnail_url,
      cover_public_id: payload.cover_public_id,
      gallery_length:  Array.isArray(payload.gallery) ? payload.gallery.length : payload.gallery,
    });

    const handleError = (error: { message: string }) => {
      console.error('❌ Save error:', error);
      setFormError(error.message);
      setSaving(false);
    };

    if (editingId) {
      const res = await fetch('/api/admin/productions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, ...payload }),
      });
      if (!res.ok) { const err = await res.json(); handleError({ message: err.error ?? 'Update failed' }); return; }
      const data = await res.json();
      setItems(prev => prev.map(p => p.id === editingId ? (data as Production) : p));
    } else {
      const res = await fetch('/api/admin/productions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const err = await res.json(); handleError({ message: err.error ?? 'Create failed' }); return; }
      const data = await res.json();
      setItems(prev => [data as Production, ...prev]);
    }

    setSaving(false);
    closeForm();
  };

  // ── Delete ──────────────────────────────────────────────────────────────────

  /**
   * Hybrid delete — folder-level:
   *   1. Build the Cloudinary folder path for this project.
   *   2. Call /api/cloudinary/delete-folder to wipe all assets under it.
   *      If Cloudinary fails → abort; DB row is NOT touched.
   *   3. Only after Cloudinary succeeds → soft-delete the DB row (deleted_at).
   */
  const remove = async (id: string) => {
    const item = items.find(p => p.id === id);
    if (!item) return;

    setDeletingId(id);
    setDeleteError(null);

    // ── 1. Build project folder path ─────────────────────────────────────────
    // Mirror the normalisation used by smartProductionFolder() in upload.ts.
    const category = item.sub_category?.trim().toLowerCase().replace(/\s+/g, '-') || 'general';
    const folder   = `thabangvision_usecase/media/smartproductions/${category}/${item.slug}`;

    // ── 2. Cloudinary folder delete ──────────────────────────────────────────
    try {
      const res  = await fetch('/api/cloudinary/delete-folder', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ folder }),
      });
      const json = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Folder delete failed');
      console.log(`🗑️ Cloudinary folder deleted: ${folder}`);
    } catch (err) {
      console.error('❌ Cloudinary folder delete failed — aborting project delete:', err);
      setDeleteError(`Media delete failed: ${(err as Error).message}. Project was NOT removed.`);
      setDeletingId(null);
      setConfirmId(null);
      return; // ← abort: DB row untouched
    }

    // ── 3. Soft-delete DB row ────────────────────────────────────────────────
    try {
      const res = await fetch('/api/admin/productions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, deleted_at: new Date().toISOString() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Soft-delete failed');
      }
      setItems(prev => prev.filter(p => p.id !== id));
      console.log(`✅ Project ${id} soft-deleted`);
    } catch (err) {
      console.error('❌ Soft-delete DB error:', err);
      setDeleteError(`Failed to delete project: ${(err as Error).message}`);
    }

    setDeletingId(null);
    setConfirmId(null);
  };

  // ── Publish toggle (optimistic) ─────────────────────────────────────────────

  const togglePublish = async (item: Production) => {
    const next = !item.is_published;
    setTogglingId(item.id);
    setItems(prev => prev.map(p => p.id === item.id ? { ...p, is_published: next } : p));
    const res = await fetch('/api/admin/productions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, is_published: next }),
    });
    if (!res.ok) {
      setItems(prev => prev.map(p => p.id === item.id ? { ...p, is_published: item.is_published } : p));
    }
    setTogglingId(null);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
  <>
    <div className="max-w-6xl mx-auto px-6 py-12">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-10">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-600 mb-1">Admin</p>
          <h1 className="text-2xl font-display font-medium uppercase text-white">Smart Productions</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={load}
            title="Refresh"
            className="p-2 border border-white/10 text-neutral-500 hover:text-white hover:border-white/30 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-[#D4A843] text-black text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity"
          >
            <Plus className="w-3 h-3" /> New Project
          </button>
        </div>
      </div>

      {/* ── Form panel ── */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="mb-10 bg-neutral-900 border border-white/10"
          >
            {/* Form topbar */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h2 className="text-xs font-mono uppercase tracking-widest text-white">
                {editingId ? 'Edit Project' : 'New Project'}
              </h2>
              <button
                onClick={closeForm}
                className="text-neutral-600 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-8">

              {/* ── Core ── */}
              <Section label="Core">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <Field
                      label="Title *"
                      value={form.title}
                      onChange={handleTitleChange}
                      placeholder="Neon Horizon"
                    />
                  </div>
                  <Field
                    label="Slug *"
                    value={form.slug}
                    onChange={v => setF('slug', v)}
                    placeholder="neon-horizon"
                    mono
                  />
                  <Field
                    label="Client"
                    value={form.client}
                    onChange={v => setF('client', v)}
                    placeholder="Warner Bros."
                  />
                </div>
              </Section>

              {/* ── Classification ── */}
              <Section label="Classification">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <SelectField
                    label="Project Type"
                    value={form.project_type}
                    onChange={v => setF('project_type', v)}
                    options={[
                      { value: 'film',        label: 'Film' },
                      { value: 'photography', label: 'Photography' },
                    ]}
                  />
                  <Field
                    label="Sub-Category"
                    value={form.sub_category}
                    onChange={v => setF('sub_category', v)}
                    placeholder="Narrative / Commercial / Portrait…"
                  />
                </div>
              </Section>

              {/* ── Description ── */}
              <Section label="Description">
                <TextareaField
                  value={form.description}
                  onChange={v => setF('description', v)}
                  placeholder="Describe the production…"
                  rows={4}
                />
              </Section>

              {/* ── Thumbnail ── */}
              <Section label="Thumbnail">
                <div className="flex flex-wrap items-start gap-4">
                  {/* Preview + crop controls */}
                  {form.thumbnail_url && (
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      {/* Thumbnail tile — 3:2 */}
                      <div className="relative group w-28 aspect-[3/2] bg-neutral-950 border border-white/10 overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={form.thumbnail_url}
                          alt="Thumbnail"
                          className={`w-full h-full object-cover transition-opacity ${deletingMedia.has('thumbnail') ? 'opacity-30' : ''}`}
                        />

                        {/* Loading */}
                        {deletingMedia.has('thumbnail') && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                            <Loader2 className="w-4 h-4 text-white animate-spin" />
                          </div>
                        )}

                        {/* Confirm delete */}
                        {!deletingMedia.has('thumbnail') && confirmMedia === 'thumbnail' && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/80">
                            <p className="text-[9px] font-mono text-white/80 uppercase tracking-widest">Delete?</p>
                            <div className="flex gap-1.5">
                              <button
                                onClick={deleteThumbnail}
                                className="px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-red-400 border border-red-500/40 hover:border-red-400 transition-colors"
                              >
                                Yes
                              </button>
                              <button
                                onClick={() => setConfirmMedia(null)}
                                className="px-2 py-1 text-[9px] font-mono text-neutral-400 border border-white/10 hover:border-white/30 transition-colors"
                              >
                                No
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Normal hover X */}
                        {!deletingMedia.has('thumbnail') && confirmMedia !== 'thumbnail' && (
                          <button
                            onClick={() => setConfirmMedia('thumbnail')}
                            title="Remove thumbnail"
                            className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                          >
                            <X className="w-4 h-4 text-white" />
                          </button>
                        )}
                      </div>

                      {/* Re-crop button */}
                      <button
                        onClick={openReCrop}
                        title="Open crop editor"
                        className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest text-neutral-500 hover:text-white transition-colors self-start"
                      >
                        <Crop className="w-2.5 h-2.5" />
                        Crop
                      </button>
                    </div>
                  )}

                  {/* Upload area */}
                  <div className="flex flex-col gap-2">
                    {/* Dropzone */}
                    <div
                      {...thumbDropzone.getRootProps()}
                      className={`w-48 h-20 border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer select-none ${
                        thumbUploading
                          ? 'border-white/5 opacity-40 pointer-events-none'
                          : thumbDropzone.isDragActive
                          ? 'border-white/50 bg-white/5'
                          : 'border-white/15 hover:border-white/30'
                      }`}
                    >
                      <input {...thumbDropzone.getInputProps()} />
                      {thumbUploading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-neutral-500" />
                          <span className="text-[9px] font-mono text-neutral-600">{thumbPct}%</span>
                          <div className="w-32 h-0.5 bg-white/10 overflow-hidden">
                            <div className="h-full bg-white transition-all duration-150" style={{ width: `${thumbPct}%` }} />
                          </div>
                        </>
                      ) : thumbDropzone.isDragActive ? (
                        <span className="text-[9px] font-mono text-white/60 uppercase tracking-widest">Drop here</span>
                      ) : (
                        <>
                          <ImagePlus className="w-4 h-4 text-neutral-600" />
                          <span className="text-[9px] font-mono text-neutral-600 uppercase tracking-widest text-center leading-tight px-2">
                            Drop or click to upload
                          </span>
                        </>
                      )}
                    </div>

                    {/* Fallback button */}
                    <label
                      className={`flex items-center gap-2 px-4 py-2 bg-neutral-950 border border-white/10 text-[10px] font-mono uppercase tracking-widest transition-colors w-fit ${
                        thumbUploading
                          ? 'text-neutral-500 cursor-not-allowed'
                          : 'text-neutral-400 hover:text-white hover:border-white/30 cursor-pointer'
                      }`}
                    >
                      {thumbUploading ? (
                        <><Loader2 className="w-3 h-3 animate-spin" /> {thumbPct}%</>
                      ) : (
                        <><ImagePlus className="w-3 h-3" /> {form.thumbnail_url ? 'Replace' : 'Browse Files'}</>
                      )}
                      <input
                        ref={thumbInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={thumbUploading}
                        onChange={handleThumbnailChange}
                      />
                    </label>

                    {form.cover_public_id && (
                      <p className="text-[9px] font-mono text-neutral-700 max-w-[200px] truncate">
                        {form.cover_public_id}
                      </p>
                    )}
                  </div>
                </div>

                {form.sub_category && (
                  <p className="text-[9px] font-mono text-neutral-700 mt-3">
                    Folder → thabangvision_usecase/media/smartproductions/
                    <span className="text-neutral-500">
                      {form.sub_category.trim().toLowerCase().replace(/\s+/g, '-') || 'general'}
                    </span>
                  </p>
                )}
              </Section>

              {/* ── Gallery ── */}
              <Section label={`Gallery${form.gallery.length > 0 ? ` (${form.gallery.length})` : ''}`}>
                {/* Preview grid */}
                {form.gallery.length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 mb-4">
                    {form.gallery.map((item, i) => {
                      const isConfirming = confirmMedia === item.public_id;
                      const isDeleting   = deletingMedia.has(item.public_id);
                      return (
                        <div
                          key={item.public_id}
                          className="relative group aspect-square bg-neutral-950 border border-white/5 overflow-hidden"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={item.url}
                            alt={`Gallery ${i + 1}`}
                            className={`w-full h-full object-cover transition-opacity ${isDeleting ? 'opacity-30' : ''}`}
                          />

                          {/* Loading */}
                          {isDeleting && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                              <Loader2 className="w-4 h-4 text-white animate-spin" />
                            </div>
                          )}

                          {/* Confirm */}
                          {!isDeleting && isConfirming && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/80">
                              <p className="text-[9px] font-mono text-white/80 uppercase tracking-widest">Delete?</p>
                              <div className="flex gap-1.5">
                                <button
                                  onClick={() => deleteGalleryItem(item)}
                                  className="px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-red-400 border border-red-500/40 hover:border-red-400 transition-colors"
                                >
                                  Yes
                                </button>
                                <button
                                  onClick={() => setConfirmMedia(null)}
                                  className="px-2 py-1 text-[9px] font-mono text-neutral-400 border border-white/10 hover:border-white/30 transition-colors"
                                >
                                  No
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Normal hover X */}
                          {!isDeleting && !isConfirming && (
                            <button
                              onClick={() => setConfirmMedia(item.public_id)}
                              title="Remove"
                              className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                            >
                              <X className="w-4 h-4 text-white" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Gallery upload area */}
                <div className="space-y-2">
                  {/* Dropzone */}
                  <div
                    {...galDropzone.getRootProps()}
                    className={`border-2 border-dashed flex flex-col items-center justify-center gap-2 py-6 px-4 transition-colors cursor-pointer select-none ${
                      galUploading
                        ? 'border-white/5 opacity-40 pointer-events-none'
                        : galDropzone.isDragActive
                        ? 'border-white/50 bg-white/5'
                        : 'border-white/15 hover:border-white/30'
                    }`}
                  >
                    <input {...galDropzone.getInputProps()} />
                    {galUploading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin text-neutral-500" />
                        <span className="text-[9px] font-mono text-neutral-500 uppercase tracking-widest">
                          {galUploaded} / {galTotal} uploaded
                        </span>
                        <div className="w-32 h-0.5 bg-white/10 overflow-hidden">
                          <div className="h-full bg-white transition-all duration-150" style={{ width: `${galPct}%` }} />
                        </div>
                      </>
                    ) : galDropzone.isDragActive ? (
                      <span className="text-[9px] font-mono text-white/60 uppercase tracking-widest">Drop files here</span>
                    ) : (
                      <>
                        <Images className="w-5 h-5 text-neutral-700" />
                        <span className="text-[9px] font-mono text-neutral-600 uppercase tracking-widest text-center">
                          Drop images / videos here
                        </span>
                        <span className="text-[9px] font-mono text-neutral-700 uppercase tracking-widest">
                          or click to browse
                        </span>
                      </>
                    )}
                  </div>

                  {/* Fallback button */}
                  <label
                    className={`flex items-center gap-2 px-4 py-2 bg-neutral-950 border border-white/10 text-[10px] font-mono uppercase tracking-widest transition-colors w-fit ${
                      galUploading
                        ? 'text-neutral-500 cursor-not-allowed'
                        : 'text-neutral-400 hover:text-white hover:border-white/30 cursor-pointer'
                    }`}
                  >
                    {galUploading ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> {galUploaded}/{galTotal}</>
                    ) : (
                      <><Images className="w-3 h-3" /> {form.gallery.length > 0 ? 'Add More Images' : 'Browse Files'}</>
                    )}
                    <input
                      ref={galInputRef}
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      className="hidden"
                      disabled={galUploading}
                      onChange={handleGalleryChange}
                    />
                  </label>

                  {/* Extract Metadata button */}
                  {form.gallery.length > 0 && (
                    <button
                      type="button"
                      onClick={doExtractMetadata}
                      disabled={extracting || galUploading}
                      className={`flex items-center gap-2 px-4 py-2 bg-neutral-950 border border-white/10 text-[10px] font-mono uppercase tracking-widest transition-colors w-fit ${
                        extracting
                          ? 'text-neutral-500 cursor-not-allowed'
                          : 'text-amber-400 hover:text-amber-300 hover:border-amber-500/30 cursor-pointer'
                      }`}
                    >
                      {extracting ? (
                        <><Loader2 className="w-3 h-3 animate-spin" /> Extracting...</>
                      ) : (
                        <><Camera className="w-3 h-3" /> Re-extract from URLs</>
                      )}
                    </button>
                  )}
                </div>

                {/* Metadata Preview */}
                {form.image_metadata.length > 0 && (
                  <div className="mt-4 border border-white/5 bg-neutral-950 p-4 space-y-2">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[9px] font-mono uppercase tracking-widest text-amber-400">
                        EXIF Data ({form.image_metadata.length} image{form.image_metadata.length !== 1 ? 's' : ''})
                      </p>
                      <button
                        type="button"
                        onClick={() => setForm(f => ({ ...f, image_metadata: [] }))}
                        className="text-[9px] font-mono text-neutral-600 hover:text-red-400 transition-colors uppercase tracking-widest"
                      >
                        Clear
                      </button>
                    </div>
                    {form.image_metadata.slice(0, 5).map((meta, i) => (
                      <div key={i} className="text-[10px] font-mono text-neutral-400 flex flex-wrap gap-x-4 gap-y-0.5">
                        {meta.camera && <span className="text-white">{meta.camera}</span>}
                        {meta.lens && <span>{meta.lens}</span>}
                        {meta.focalLength && <span>{meta.focalLength}mm</span>}
                        {meta.aperture && <span>f/{meta.aperture}</span>}
                        {meta.iso && <span>ISO {meta.iso}</span>}
                        {meta.shutterSpeed && <span>{meta.shutterSpeed}</span>}
                        {meta.software && <span className="text-neutral-600">{meta.software}</span>}
                      </div>
                    ))}
                    {form.image_metadata.length > 5 && (
                      <p className="text-[9px] font-mono text-neutral-700">
                        +{form.image_metadata.length - 5} more...
                      </p>
                    )}
                  </div>
                )}
              </Section>

              {/* ── Video ── */}
              <Section label="Video">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <SelectField
                    label="Provider"
                    value={form.video_provider}
                    onChange={v => setForm(f => ({
                      ...f,
                      video_provider: v,
                      video_url: v ? f.video_url : '',
                    }))}
                    options={[
                      { value: '',        label: 'None' },
                      { value: 'youtube', label: 'YouTube' },
                      { value: 'vimeo',   label: 'Vimeo' },
                    ]}
                  />
                  <Field
                    label="Video URL"
                    value={form.video_url}
                    onChange={v => setF('video_url', v)}
                    placeholder="https://…"
                    disabled={!form.video_provider}
                  />
                </div>
              </Section>

              {/* ── Tags ── */}
              <Section label="Tags">
                <Field
                  label="Comma-separated"
                  value={form.tags}
                  onChange={v => setF('tags', v)}
                  placeholder="Anamorphic, Virtual Production, Large Format"
                />
              </Section>

              {/* ── Visibility ── */}
              <Section label="Visibility">
                <div className="flex flex-wrap gap-8">
                  <CheckboxField
                    label="Published"
                    checked={form.is_published}
                    onChange={v => setF('is_published', v)}
                  />
                  <CheckboxField
                    label="Featured"
                    checked={form.is_featured}
                    onChange={v => setF('is_featured', v)}
                  />
                </div>
              </Section>

              {/* Error */}
              {formError && (
                <p className="text-xs font-mono text-red-400 bg-red-500/10 border border-red-500/20 px-4 py-3">
                  {formError}
                </p>
              )}

              {/* Upload-in-progress notice */}
              {isUploading && (
                <p className="text-[10px] font-mono text-amber-400/80 uppercase tracking-widest">
                  Upload in progress — save will be available when complete.
                </p>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2 border-t border-white/5">
                <button
                  onClick={save}
                  disabled={saving || isUploading}
                  className="flex items-center gap-2 px-5 py-2.5 bg-[#D4A843] text-black text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={closeForm}
                  disabled={saving}
                  className="px-5 py-2.5 border border-white/20 text-[10px] font-mono uppercase tracking-widest text-neutral-400 hover:text-white hover:border-white/40 transition-colors disabled:opacity-40"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Delete error banner ── */}
      {deleteError && (
        <div className="mb-6 flex items-start justify-between gap-4 bg-red-500/10 border border-red-500/20 px-4 py-3">
          <p className="text-xs font-mono text-red-400">{deleteError}</p>
          <button
            onClick={() => setDeleteError(null)}
            className="text-red-600 hover:text-red-400 transition-colors flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── List ── */}
      {loading ? (
        <div className="flex items-center justify-center py-40">
          <Loader2 className="w-5 h-5 text-neutral-600 animate-spin" />
        </div>
      ) : fetchError ? (
        <div className="py-20 text-center bg-red-500/5 border border-red-500/20">
          <p className="text-red-400 font-mono text-sm mb-4">{fetchError}</p>
          <button
            onClick={load}
            className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 hover:text-white transition-colors"
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-40 border border-white/5">
          <p className="text-neutral-600 font-mono text-sm mb-4">No projects yet.</p>
          <button
            onClick={openCreate}
            className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 hover:text-white transition-colors"
          >
            Create the first one →
          </button>
        </div>
      ) : (
        <>
          {/* Column header */}
          <div className="hidden md:grid grid-cols-[40px_1fr_100px_64px_90px_40px_160px] gap-4 px-4 py-3 text-[9px] font-mono uppercase tracking-widest text-neutral-700 border-b border-white/5">
            <span></span>
            <span>Title</span>
            <span>Type</span>
            <span>Year</span>
            <span>Status</span>
            <span></span>
            <span className="text-right">Actions</span>
          </div>

          <motion.div layout className="space-y-px">
            <AnimatePresence initial={false}>
              {items.map(item => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden"
                >
                  <div className="grid grid-cols-1 md:grid-cols-[40px_1fr_100px_64px_90px_40px_160px] gap-4 items-center px-4 py-4 bg-neutral-900 border border-white/5 hover:border-white/10 transition-colors">

                    {/* Thumbnail */}
                    <div className="hidden md:block w-10 h-7 bg-neutral-800 flex-shrink-0 overflow-hidden">
                      {item.thumbnail_url
                        ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.thumbnail_url}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        )
                        : <div className="w-full h-full bg-neutral-800" />
                      }
                    </div>

                    {/* Title + client */}
                    <div className="min-w-0">
                      <p className="text-sm font-mono text-white truncate leading-tight">{item.title}</p>
                      {item.client && (
                        <p className="text-[10px] font-mono text-neutral-600 mt-0.5 truncate">{item.client}</p>
                      )}
                    </div>

                    {/* Type */}
                    <span className="hidden md:block text-[10px] font-mono uppercase tracking-widest text-neutral-500 truncate">
                      {item.project_type}
                    </span>

                    {/* Year */}
                    <span className="hidden md:block text-[10px] font-mono text-neutral-500">
                      {item.year ?? '—'}
                    </span>

                    {/* Status */}
                    <div className="hidden md:flex items-center gap-2">
                      <span
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors ${
                          item.is_published ? 'bg-emerald-400' : 'bg-neutral-600'
                        }`}
                      />
                      <span className="text-[9px] font-mono uppercase tracking-wider text-neutral-500">
                        {item.is_published ? 'Live' : 'Draft'}
                      </span>
                    </div>

                    {/* Featured */}
                    <div className="hidden md:block">
                      {item.is_featured && (
                        <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 md:justify-end">
                      <ActionBtn
                        onClick={() => togglePublish(item)}
                        title={item.is_published ? 'Unpublish' : 'Publish'}
                        loading={togglingId === item.id}
                      >
                        {item.is_published
                          ? <EyeOff className="w-3.5 h-3.5" />
                          : <Eye    className="w-3.5 h-3.5" />
                        }
                      </ActionBtn>

                      <ActionBtn onClick={() => openEdit(item)} title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </ActionBtn>

                      {confirmId === item.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => remove(item.id)}
                            disabled={deletingId === item.id}
                            className="px-2 py-1 text-[9px] font-mono uppercase tracking-widest text-red-400 border border-red-500/40 hover:border-red-400 transition-colors disabled:opacity-40"
                          >
                            {deletingId === item.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : 'Confirm'}
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            className="px-2 py-1 text-[9px] font-mono text-neutral-500 border border-white/10 hover:border-white/30 transition-colors"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <ActionBtn
                          onClick={() => setConfirmId(item.id)}
                          title="Delete"
                          danger
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </ActionBtn>
                      )}
                    </div>

                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>

          <p className="text-[9px] font-mono text-neutral-700 uppercase tracking-widest mt-6 text-right">
            {items.length} project{items.length !== 1 ? 's' : ''}
          </p>
        </>
      )}
    </div>

    {/* ── Crop Modal ────────────────────────────────────────────────────────── */}
    {showCropModal && cropSourceUrl && (
      <div className="fixed inset-0 z-50 flex flex-col bg-black">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Crop className="w-4 h-4 text-neutral-500" />
            <h3 className="text-xs font-mono uppercase tracking-widest text-white">Crop Thumbnail</h3>
            <span className="text-[10px] font-mono text-neutral-600 uppercase tracking-widest">3 : 2</span>
          </div>
          <button
            onClick={skipCrop}
            title="Close without cropping"
            className="text-neutral-600 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Cropper — fills remaining height */}
        <div className="relative flex-1">
          <Cropper
            image={cropSourceUrl}
            crop={cropperCrop}
            zoom={cropperZoom}
            aspect={3 / 2}
            onCropChange={setCropperCrop}
            onZoomChange={setCropperZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        {/* Zoom + actions */}
        <div className="flex-shrink-0 flex items-center gap-4 px-6 py-4 border-t border-white/10 bg-black">
          <span className="text-[10px] font-mono text-neutral-600 uppercase tracking-widest w-10 flex-shrink-0">
            Zoom
          </span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={cropperZoom}
            onChange={e => setCropperZoom(Number(e.target.value))}
            className="flex-1 accent-white"
          />
          <div className="flex gap-2 ml-4 flex-shrink-0">
            <button
              onClick={skipCrop}
              className="px-4 py-2 border border-white/20 text-[10px] font-mono uppercase tracking-widest text-neutral-400 hover:text-white hover:border-white/40 transition-colors"
            >
              Skip
            </button>
            <button
              onClick={() => void applyCropFromModal()}
              className="px-4 py-2 bg-[#D4A843] text-black text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity"
            >
              Apply Crop
            </button>
          </div>
        </div>
      </div>
    )}

  </>
  );
}

// ─── UI primitives ────────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] font-mono uppercase tracking-widest text-neutral-600 mb-3 pb-2 border-b border-white/5">
        {label}
      </p>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono = false,
  disabled = false,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
}) {
  return (
    <div>
      {label && (
        <label className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
          {label}
        </label>
      )}
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full bg-neutral-950 border border-white/10 text-white text-sm px-3 py-2 placeholder:text-neutral-700 focus:outline-none focus:border-white/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors ${
          mono ? 'font-mono' : ''
        }`}
      />
    </div>
  );
}

function TextareaField({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full bg-neutral-950 border border-white/10 text-white text-sm px-3 py-2 placeholder:text-neutral-700 focus:outline-none focus:border-white/30 resize-none transition-colors"
    />
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
        {label}
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-neutral-950 border border-white/10 text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-white/30 transition-colors"
      >
        {options.map(o => (
          <option key={o.value} value={o.value} className="bg-neutral-900">
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-400 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="accent-white"
      />
      {label}
    </label>
  );
}

function ActionBtn({
  onClick,
  title,
  danger = false,
  loading = false,
  children,
}: {
  onClick: () => void;
  title: string;
  danger?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={loading}
      className={`p-2 border transition-colors disabled:opacity-40 ${
        danger
          ? 'border-red-900/40 text-red-600 hover:border-red-500/40 hover:text-red-400'
          : 'border-white/10 text-neutral-500 hover:border-white/30 hover:text-white'
      }`}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : children}
    </button>
  );
}
