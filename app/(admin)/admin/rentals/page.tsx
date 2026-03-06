'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Crop, Eye, EyeOff, ImagePlus, Images, Loader2,
  Pencil, Plus, RefreshCw, Star, Trash2, X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { uploadFile, type CloudinaryAsset } from '@/lib/cloudinary/upload';

// ─── Types ───────────────────────────────────────────────────────────────────

type GalleryItem = CloudinaryAsset;

type MetaRow = { key: string; value: string };

type Rental = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string;
  sub_category: string | null;
  brand: string | null;
  model: string | null;
  price_per_day: number | null;
  price_per_week: number | null;
  deposit_amount: number | null;
  currency: string;
  thumbnail_url: string | null;
  cover_public_id: string | null;
  gallery: GalleryItem[] | null;
  is_available: boolean;
  quantity: number;
  is_published: boolean;
  is_featured: boolean;
  is_archived: boolean;
  tags: string[] | null;
  features: string[] | null;
  rental_includes: string[] | null;
  metadata: Record<string, string> | null;
  video_provider: string | null;
  video_url: string | null;
  video_id: string | null;
  created_at: string;
  deleted_at: string | null;
};

type Form = {
  title: string;
  slug: string;
  description: string;
  category: string;
  category_other: string;
  sub_category: string;
  brand: string;
  model: string;
  price_per_day: string;
  price_per_week: string;
  deposit_amount: string;
  currency: string;
  thumbnail_url: string;
  cover_public_id: string;
  gallery: GalleryItem[];
  is_available: boolean;
  quantity: string;
  is_published: boolean;
  is_featured: boolean;
  is_archived: boolean;
  tags: string;
  features: string;
  rental_includes: string;
  meta_rows: MetaRow[];
  video_provider: string;
  video_url: string;
};

const EMPTY_FORM: Form = {
  title: '',
  slug: '',
  description: '',
  category: '',
  category_other: '',
  sub_category: '',
  brand: '',
  model: '',
  price_per_day: '',
  price_per_week: '',
  deposit_amount: '',
  currency: 'ZAR',
  thumbnail_url: '',
  cover_public_id: '',
  gallery: [],
  is_available: true,
  quantity: '1',
  is_published: false,
  is_featured: false,
  is_archived: false,
  tags: '',
  features: '',
  rental_includes: '',
  meta_rows: [],
  video_provider: '',
  video_url: '',
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Canvas-crops an image to the given pixel rect and returns it as a JPEG File.
 * The cropped image is uploaded as the thumbnail — no extra DB column needed.
 */
async function getCroppedImg(imageSrc: string, pixelCrop: Area): Promise<File> {
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
 * Cloudinary upload folder for a rental.
 * Structure: thabangvision_usecase/media/smartrentals/{category}/{slug}
 * sub_category is NOT part of the folder path — it is DB/filter metadata only.
 */
function buildRentalFolder(category: string, slug: string): string {
  return `thabangvision_usecase/media/smartrentals/${category}/${slug}`;
}

/**
 * Resolves the effective category slug from form state.
 * When "Other…" is selected, autoSlug() is applied to the custom input.
 */
function resolveCategory(f: Pick<Form, 'category' | 'category_other'>): string {
  return f.category === '__other__'
    ? autoSlug(f.category_other.trim()) || 'uncategorized'
    : f.category || 'uncategorized';
}

function parseNum(v: string): number | null {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

/**
 * Extracts a canonical video ID from a provider URL.
 * YouTube: supports watch?v=, youtu.be/, and /embed/ forms.
 * Vimeo:   supports vimeo.com/NNN and vimeo.com/video/NNN.
 * Returns null for an unrecognised URL or unknown provider.
 */
function extractVideoId(provider: string, url: string): string | null {
  const u = url.trim();
  if (!u) return null;
  if (provider === 'youtube') {
    const m = u.match(/(?:v=|youtu\.be\/|embed\/)([^&\n?#]+)/);
    return m?.[1] ?? null;
  }
  if (provider === 'vimeo') {
    const m = u.match(/(?:vimeo\.com\/(?:video\/)?)(\d+)/);
    return m?.[1] ?? null;
  }
  return null;
}

const RENTAL_CATEGORIES: { value: string; label: string }[] = [
  { value: '',                      label: '— Select category —' },
  { value: 'cameras-optics',        label: 'Cameras & Optics' },
  { value: 'lighting-power',        label: 'Lighting & Power' },
  { value: 'audio',                 label: 'Audio' },
  { value: 'grip-motion',           label: 'Grip & Motion' },
  { value: 'data-storage',          label: 'Data & Storage' },
  { value: 'crew-services',         label: 'Crew Services' },
  { value: 'specialized-solutions', label: 'Specialized Solutions' },
  { value: '__other__',             label: 'Other…' },
];

function formToPayload(f: Form) {
  return {
    title:           f.title.trim(),
    slug:            f.slug.trim(),
    description:     f.description.trim()     || null,
    category:        f.category === '__other__'
      ? autoSlug(f.category_other.trim()) || 'uncategorized'
      : f.category.trim(),
    sub_category:    f.sub_category.trim()    || null,
    brand:           f.brand.trim()           || null,
    model:           f.model.trim()           || null,
    price_per_day:   parseNum(f.price_per_day),
    price_per_week:  parseNum(f.price_per_week),
    deposit_amount:  parseNum(f.deposit_amount),
    currency:        f.currency               || 'ZAR',
    thumbnail_url:   f.thumbnail_url          || null,
    cover_public_id: f.cover_public_id        || null,
    gallery:         f.gallery.length > 0 ? f.gallery : [],
    is_available:    f.is_available,
    quantity:        parseInt(f.quantity || '1', 10),
    is_published:    f.is_published,
    is_featured:     f.is_featured,
    is_archived:     f.is_archived,
    tags:            f.tags.trim()
      ? f.tags.split(',').map(t => t.trim()).filter(Boolean)
      : null,
    features:        f.features.trim()
      ? f.features.split('\n').map(s => s.trim()).filter(Boolean)
      : [],
    rental_includes: f.rental_includes.trim()
      ? f.rental_includes.split('\n').map(s => s.trim()).filter(Boolean)
      : [],
    metadata:        f.meta_rows.reduce<Record<string, string>>((acc, row) => {
      const key = row.key.trim();
      if (key) acc[key] = row.value.trim();
      return acc;
    }, {}),
    video_provider:  f.video_provider || null,
    video_url:       f.video_url.trim() || null,
    video_id:        f.video_provider && f.video_url.trim()
      ? extractVideoId(f.video_provider, f.video_url.trim())
      : null,
    updated_at:      new Date().toISOString(),
  };
}

function rentalToForm(r: Rental): Form {
  const knownCats = RENTAL_CATEGORIES.map(c => c.value).filter(v => v && v !== '__other__');
  const isKnown   = knownCats.includes(r.category);
  return {
    title:           r.title,
    slug:            r.slug,
    description:     r.description     ?? '',
    category:        isKnown ? r.category : '__other__',
    category_other:  isKnown ? '' : r.category,
    sub_category:    r.sub_category    ?? '',
    brand:           r.brand           ?? '',
    model:           r.model           ?? '',
    price_per_day:   r.price_per_day   != null ? String(r.price_per_day)  : '',
    price_per_week:  r.price_per_week  != null ? String(r.price_per_week) : '',
    deposit_amount:  r.deposit_amount  != null ? String(r.deposit_amount) : '',
    currency:        r.currency        || 'ZAR',
    thumbnail_url:   r.thumbnail_url   ?? '',
    cover_public_id: r.cover_public_id ?? '',
    gallery:         r.gallery         ?? [],
    is_available:    r.is_available,
    quantity:        String(r.quantity ?? 1),
    is_published:    r.is_published,
    is_featured:     r.is_featured,
    is_archived:     r.is_archived,
    tags:            (r.tags ?? []).join(', '),
    features:        (r.features ?? []).join('\n'),
    rental_includes: (r.rental_includes ?? []).join('\n'),
    meta_rows:       r.metadata
      ? Object.entries(r.metadata).map(([key, value]) => ({ key, value }))
      : [],
    video_provider:  r.video_provider ?? '',
    video_url:       r.video_url      ?? '',
  };
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AdminRentalsPage() {
  // List state
  const [items,      setItems]      = useState<Rental[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Form state
  const [showForm,  setShowForm]  = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form,      setForm]      = useState<Form>(EMPTY_FORM);
  const [saving,    setSaving]    = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Upload state
  const [thumbUploading, setThumbUploading] = useState(false);
  const [thumbPct,       setThumbPct]       = useState(0);
  const [galUploading,   setGalUploading]   = useState(false);
  const [galPct,         setGalPct]         = useState(0);
  const [galUploaded,    setGalUploaded]    = useState(0);
  const [galTotal,       setGalTotal]       = useState(0);

  // Row-level action state
  const [togglingId,  setTogglingId]  = useState<string | null>(null);
  const [confirmId,   setConfirmId]   = useState<string | null>(null);
  const [deletingId,  setDeletingId]  = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Per-media delete state (gallery tiles + thumbnail)
  const [confirmMedia,  setConfirmMedia]  = useState<string | null>(null);
  const [deletingMedia, setDeletingMedia] = useState<Set<string>>(new Set());

  // Crop modal state
  const [showCropModal,     setShowCropModal]     = useState(false);
  const [cropSourceUrl,     setCropSourceUrl]     = useState<string | null>(null);
  const [cropperCrop,       setCropperCrop]       = useState({ x: 0, y: 0 });
  const [cropperZoom,       setCropperZoom]       = useState(1);
  const [pendingCropPixels, setPendingCropPixels] = useState<Area | null>(null);

  // File input refs
  const thumbInputRef = useRef<HTMLInputElement>(null);
  const galInputRef   = useRef<HTMLInputElement>(null);

  // Live form ref — always current for async handlers
  const formRef = useRef<Form>(form);
  formRef.current = form;

  const isUploading = thumbUploading || galUploading;

  // ── Fetch ───────────────────────────────────────────────────────────────────

  const load = async () => {
    setLoading(true);
    setFetchError(null);
    const { data, error } = await createClient()
      .from('smart_rentals')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) setFetchError(error.message);
    else setItems((data as Rental[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // ── Form helpers ────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (item: Rental) => {
    setEditingId(item.id);
    setForm(rentalToForm(item));
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

  // ── Metadata row helpers ─────────────────────────────────────────────────────

  const addMetaRow = () =>
    setForm(f => ({ ...f, meta_rows: [...f.meta_rows, { key: '', value: '' }] }));

  const removeMetaRow = (i: number) =>
    setForm(f => ({ ...f, meta_rows: f.meta_rows.filter((_, idx) => idx !== i) }));

  const updateMetaRow = (i: number, field: 'key' | 'value', v: string) =>
    setForm(f => ({
      ...f,
      meta_rows: f.meta_rows.map((row, idx) =>
        idx === i ? { ...row, [field]: v } : row
      ),
    }));

  // ── Upload helpers ───────────────────────────────────────────────────────────

  const doThumbnailUpload = async (file: File) => {
    const folder = buildRentalFolder(resolveCategory(formRef.current), formRef.current.slug);
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
    const folder = buildRentalFolder(resolveCategory(formRef.current), formRef.current.slug);
    setGalUploading(true);
    setGalPct(0);
    setGalUploaded(0);
    setGalTotal(files.length);
    setFormError(null);
    try {
      let done = 0;
      const assets = await Promise.all(
        files.map(file =>
          uploadFile(file, folder).then(asset => {
            done++;
            setGalUploaded(done);
            setGalPct(Math.round((done / files.length) * 100));
            return asset;
          }),
        ),
      );
      setForm(prev => ({ ...prev, gallery: [...prev.gallery, ...assets] }));
    } catch (err) {
      setFormError(`Gallery upload failed: ${(err as Error).message}`);
    } finally {
      setGalUploading(false);
      if (galInputRef.current) galInputRef.current.value = '';
    }
  };

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

  const resourceTypeFromUrl = (url: string): 'image' | 'video' | 'raw' => {
    if (url.includes('/video/')) return 'video';
    if (url.includes('/raw/'))   return 'raw';
    return 'image';
  };

  const callCloudinaryDelete = async (public_id: string, url: string) => {
    const res = await fetch('/api/cloudinary/delete', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ public_id, resource_type: resourceTypeFromUrl(url) }),
    });
    const json = await res.json() as { success?: boolean; error?: string };
    if (!res.ok || !json.success) throw new Error(json.error ?? 'Cloudinary delete failed');
  };

  const syncGalleryToSupabase = async (rentalId: string, gallery: GalleryItem[]) => {
    const { error } = await createClient()
      .from('smart_rentals')
      .update({ gallery: gallery.length > 0 ? gallery : [] })
      .eq('id', rentalId);
    if (error) throw new Error(`DB sync failed: ${error.message}`);
  };

  const deleteGalleryItem = async (item: GalleryItem) => {
    const { public_id, url } = item;
    setConfirmMedia(null);
    setForm(f => ({ ...f, gallery: f.gallery.filter(g => g.public_id !== public_id) }));
    setDeletingMedia(prev => new Set(prev).add(public_id));
    try {
      await callCloudinaryDelete(public_id, url);
      if (editingId) {
        await syncGalleryToSupabase(editingId, formRef.current.gallery);
      }
    } catch (err) {
      setForm(f => ({ ...f, gallery: [...f.gallery, item] }));
      setFormError(`Delete failed: ${(err as Error).message}`);
    } finally {
      setDeletingMedia(prev => { const s = new Set(prev); s.delete(public_id); return s; });
    }
  };

  const deleteThumbnail = async () => {
    const { thumbnail_url, cover_public_id } = formRef.current;
    setConfirmMedia(null);

    if (!cover_public_id) {
      setForm(f => ({ ...f, thumbnail_url: '', cover_public_id: '' }));
      return;
    }

    setDeletingMedia(prev => new Set(prev).add('thumbnail'));
    try {
      await callCloudinaryDelete(cover_public_id, thumbnail_url);
      setForm(f => ({ ...f, thumbnail_url: '', cover_public_id: '' }));

      if (editingId) {
        const { error } = await createClient()
          .from('smart_rentals')
          .update({ thumbnail_url: null, cover_public_id: null })
          .eq('id', editingId);
        if (error) throw new Error(`DB sync failed: ${error.message}`);
      }
    } catch (err) {
      setFormError(`Thumbnail delete failed: ${(err as Error).message}`);
    } finally {
      setDeletingMedia(prev => { const s = new Set(prev); s.delete('thumbnail'); return s; });
    }
  };

  // ── Crop modal handlers ──────────────────────────────────────────────────────

  const onCropComplete = useCallback((_: Area, croppedAreaPixels: Area) => {
    setPendingCropPixels(croppedAreaPixels);
  }, []);

  /**
   * Canvas-crops the source image, deletes the old Cloudinary asset (silently),
   * uploads the cropped JPEG, and updates the form with the new URL.
   */
  const applyCropFromModal = async () => {
    if (!cropSourceUrl || !pendingCropPixels) return;
    setShowCropModal(false);
    setThumbUploading(true);
    setThumbPct(0);
    setFormError(null);
    try {
      const croppedFile = await getCroppedImg(cropSourceUrl, pendingCropPixels);

      const { cover_public_id: oldId, thumbnail_url: oldUrl } = formRef.current;
      if (oldId && oldUrl) {
        try { await callCloudinaryDelete(oldId, oldUrl); } catch { /* ignored */ }
      }

      const folder = buildRentalFolder(resolveCategory(formRef.current), formRef.current.slug);
      const asset  = await uploadFile(croppedFile, folder, pct => setThumbPct(pct));
      setForm(f => ({ ...f, thumbnail_url: asset.url, cover_public_id: asset.public_id }));
    } catch (err) {
      setFormError(`Crop upload failed: ${(err as Error).message}`);
    } finally {
      setThumbUploading(false);
    }
  };

  const skipCrop = () => setShowCropModal(false);

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
    const f = formRef.current;
    if (!f.title.trim())    { setFormError('Title is required.');    return; }
    if (!f.slug.trim())     { setFormError('Slug is required.');     return; }
    if (!f.category.trim()) { setFormError('Category is required.'); return; }
    if (f.category === '__other__' && !f.category_other.trim()) {
      setFormError('Please enter a custom category name.'); return;
    }

    setSaving(true);
    setFormError(null);

    const supabase = createClient();
    const payload  = formToPayload(f);

    const handleError = (error: { message: string; code?: string; details?: string }) => {
      const msg = `${error.message}${error.details ? ` — ${error.details}` : ''}`;
      console.error('❌ Supabase save error:', error);
      setFormError(msg);
      setSaving(false);
    };

    if (editingId) {
      const { error } = await supabase
        .from('smart_rentals')
        .update(payload)
        .eq('id', editingId);
      if (error) { handleError(error); return; }
      setItems(prev => prev.map(r =>
        r.id === editingId ? { ...r, ...payload } as Rental : r,
      ));
    } else {
      const { data, error } = await supabase
        .from('smart_rentals')
        .insert(payload)
        .select()
        .single();
      if (error) { handleError(error); return; }
      setItems(prev => [data as Rental, ...prev]);
    }

    setSaving(false);
    closeForm();
  };

  // ── Soft delete ─────────────────────────────────────────────────────────────

  /**
   * Soft delete:
   *   1. Delete Cloudinary folder (category/slug prefix) — abort if it fails.
   *   2. Set deleted_at = now() AND is_archived = true on the DB row.
   */
  const remove = async (id: string) => {
    const item = items.find(r => r.id === id);
    if (!item) return;

    setDeletingId(id);
    setDeleteError(null);

    // 1. Cloudinary folder delete — item.category is always a resolved slug from the DB
    const folder = buildRentalFolder(item.category, item.slug);

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
      console.error('❌ Cloudinary folder delete failed — aborting rental delete:', err);
      setDeleteError(`Media delete failed: ${(err as Error).message}. Rental was NOT removed.`);
      setDeletingId(null);
      setConfirmId(null);
      return;
    }

    // 2. Soft-delete DB row
    const { error } = await createClient()
      .from('smart_rentals')
      .update({ deleted_at: new Date().toISOString(), is_archived: true })
      .eq('id', id);

    if (error) {
      console.error('❌ Soft-delete DB error:', error);
      setDeleteError(`Failed to delete rental: ${error.message}`);
    } else {
      setItems(prev => prev.filter(r => r.id !== id));
      console.log(`✅ Rental ${id} soft-deleted`);
    }

    setDeletingId(null);
    setConfirmId(null);
  };

  // ── Publish toggle ───────────────────────────────────────────────────────────

  const togglePublish = async (item: Rental) => {
    const next = !item.is_published;
    setTogglingId(item.id);
    setItems(prev => prev.map(r => r.id === item.id ? { ...r, is_published: next } : r));
    const { error } = await createClient()
      .from('smart_rentals')
      .update({ is_published: next })
      .eq('id', item.id);
    if (error) {
      setItems(prev => prev.map(r =>
        r.id === item.id ? { ...r, is_published: item.is_published } : r,
      ));
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
          <h1 className="text-2xl font-display font-medium uppercase text-white">Smart Rentals</h1>
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
            className="flex items-center gap-2 px-4 py-2 bg-white text-black text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity"
          >
            <Plus className="w-3 h-3" /> New Rental
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
                {editingId ? 'Edit Rental' : 'New Rental'}
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
                      placeholder="Canon EOS C300 Mark III"
                    />
                  </div>
                  <Field
                    label="Slug *"
                    value={form.slug}
                    onChange={v => setF('slug', v)}
                    placeholder="canon-eos-c300-iii"
                    mono
                  />
                </div>
              </Section>

              {/* ── Classification ── */}
              <Section label="Classification">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <SelectField
                      label="Category *"
                      value={form.category}
                      onChange={v => { setF('category', v); if (v !== '__other__') setF('category_other', ''); }}
                      options={RENTAL_CATEGORIES}
                    />
                    {form.category === '__other__' && (
                      <Field
                        label="New Category"
                        value={form.category_other}
                        onChange={v => setF('category_other', v)}
                        placeholder="e.g. drones — auto-slugified on save"
                        mono
                      />
                    )}
                  </div>
                  <Field
                    label="Sub-Category"
                    value={form.sub_category}
                    onChange={v => setF('sub_category', v)}
                    placeholder="Cinema Camera / LED Panel…"
                  />
                  <Field
                    label="Brand"
                    value={form.brand}
                    onChange={v => setF('brand', v)}
                    placeholder="Canon"
                  />
                  <Field
                    label="Model"
                    value={form.model}
                    onChange={v => setF('model', v)}
                    placeholder="EOS C300 Mark III"
                  />
                </div>
              </Section>

              {/* ── Description ── */}
              <Section label="Description">
                <TextareaField
                  value={form.description}
                  onChange={v => setF('description', v)}
                  placeholder="Describe the rental item…"
                  rows={4}
                />
              </Section>

              {/* ── Features ── */}
              <Section label="Features">
                <TextareaField
                  value={form.features}
                  onChange={v => setF('features', v)}
                  placeholder="One feature per line"
                  rows={4}
                />
                <p className="mt-2 text-[10px] font-mono text-neutral-700">
                  Each line is saved as a separate feature string.
                </p>
              </Section>

              {/* ── Rental Includes ── */}
              <Section label="Rental Includes">
                <TextareaField
                  value={form.rental_includes}
                  onChange={v => setF('rental_includes', v)}
                  placeholder="One item per line"
                  rows={4}
                />
                <p className="mt-2 text-[10px] font-mono text-neutral-700">
                  Each line is saved as a separate rental include item.
                </p>
              </Section>

              {/* ── Technical Specifications ── */}
              <Section label="Technical Specifications">
                <div className="space-y-2">
                  {form.meta_rows.length === 0 && (
                    <p className="text-[10px] font-mono text-neutral-700 italic py-1">
                      No specs added yet — use &quot;+ Add Spec&quot; below.
                    </p>
                  )}
                  {form.meta_rows.map((row, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input
                        type="text"
                        value={row.key}
                        onChange={e => updateMetaRow(i, 'key', e.target.value)}
                        placeholder="Key  (e.g. sensor)"
                        className="flex-1 bg-neutral-950 border border-white/10 text-white text-sm px-3 py-2 placeholder:text-neutral-700 focus:outline-none focus:border-white/30 transition-colors font-mono"
                      />
                      <input
                        type="text"
                        value={row.value}
                        onChange={e => updateMetaRow(i, 'value', e.target.value)}
                        placeholder="Value  (e.g. Full Frame)"
                        className="flex-1 bg-neutral-950 border border-white/10 text-white text-sm px-3 py-2 placeholder:text-neutral-700 focus:outline-none focus:border-white/30 transition-colors"
                      />
                      <button
                        onClick={() => removeMetaRow(i)}
                        title="Remove spec"
                        className="text-neutral-600 hover:text-red-400 transition-colors flex-shrink-0 p-1"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={addMetaRow}
                  className="mt-3 flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-500 hover:text-white transition-colors"
                >
                  <Plus className="w-3 h-3" /> Add Spec
                </button>
              </Section>

              {/* ── Pricing ── */}
              <Section label="Pricing">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <SelectField
                    label="Currency"
                    value={form.currency}
                    onChange={v => setF('currency', v)}
                    options={[
                      { value: 'ZAR', label: 'ZAR' },
                      { value: 'USD', label: 'USD' },
                      { value: 'EUR', label: 'EUR' },
                      { value: 'GBP', label: 'GBP' },
                    ]}
                  />
                  <Field
                    label="Per Day"
                    value={form.price_per_day}
                    onChange={v => setF('price_per_day', v)}
                    placeholder="0.00"
                    mono
                  />
                  <Field
                    label="Per Week"
                    value={form.price_per_week}
                    onChange={v => setF('price_per_week', v)}
                    placeholder="0.00"
                    mono
                  />
                  <Field
                    label="Deposit"
                    value={form.deposit_amount}
                    onChange={v => setF('deposit_amount', v)}
                    placeholder="0.00"
                    mono
                  />
                </div>
              </Section>

              {/* ── Stock ── */}
              <Section label="Stock">
                <div className="grid grid-cols-2 gap-4">
                  <Field
                    label="Quantity"
                    value={form.quantity}
                    onChange={v => setF('quantity', v)}
                    placeholder="1"
                    mono
                  />
                  <div className="flex items-end pb-2">
                    <CheckboxField
                      label="Available for Rental"
                      checked={form.is_available}
                      onChange={v => setF('is_available', v)}
                    />
                  </div>
                </div>
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

                {(form.category || form.slug) && (
                  <p className="text-[9px] font-mono text-neutral-700 mt-3">
                    Folder → thabangvision_usecase/media/smartrentals/
                    <span className="text-neutral-500">
                      {resolveCategory(form)}{form.slug ? `/${form.slug}` : ''}
                    </span>
                  </p>
                )}
              </Section>

              {/* ── Gallery ── */}
              <Section label={`Gallery${form.gallery.length > 0 ? ` (${form.gallery.length})` : ''}`}>
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
                          {isDeleting && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                              <Loader2 className="w-4 h-4 text-white animate-spin" />
                            </div>
                          )}
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

                <div className="space-y-2">
                  {/* Gallery dropzone */}
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
                      <><Images className="w-3 h-3" /> {form.gallery.length > 0 ? 'Add More' : 'Browse Files'}</>
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
                </div>
              </Section>

              {/* ── Video ── */}
              <Section label="Video">
                <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4">
                  <SelectField
                    label="Provider"
                    value={form.video_provider}
                    onChange={v => setF('video_provider', v)}
                    options={[
                      { value: '',        label: 'None' },
                      { value: 'youtube', label: 'YouTube' },
                      { value: 'vimeo',   label: 'Vimeo' },
                    ]}
                  />
                  {form.video_provider && (
                    <Field
                      label="Video URL"
                      value={form.video_url}
                      onChange={v => setF('video_url', v)}
                      placeholder={
                        form.video_provider === 'youtube'
                          ? 'https://youtube.com/watch?v=…'
                          : 'https://vimeo.com/…'
                      }
                      mono
                    />
                  )}
                </div>
                {form.video_provider && form.video_url && (
                  <p className="mt-2 text-[10px] font-mono text-neutral-700">
                    Video ID:{' '}
                    <span className={extractVideoId(form.video_provider, form.video_url) ? 'text-neutral-500' : 'text-red-600/60'}>
                      {extractVideoId(form.video_provider, form.video_url) ?? 'Could not extract — check URL'}
                    </span>
                  </p>
                )}
              </Section>

              {/* ── Tags ── */}
              <Section label="Tags">
                <Field
                  label="Comma-separated"
                  value={form.tags}
                  onChange={v => setF('tags', v)}
                  placeholder="Wireless, Broadcast, Cinema"
                />
              </Section>

              {/* ── Visibility ── */}
              <Section label="Visibility">
                <div className="flex flex-wrap gap-8">
                  <CheckboxField label="Published" checked={form.is_published} onChange={v => setF('is_published', v)} />
                  <CheckboxField label="Featured"  checked={form.is_featured}  onChange={v => setF('is_featured', v)}  />
                  <CheckboxField label="Archived"  checked={form.is_archived}  onChange={v => setF('is_archived', v)}  />
                </div>
              </Section>

              {/* Error */}
              {formError && (
                <p className="text-xs font-mono text-red-400 bg-red-500/10 border border-red-500/20 px-4 py-3">
                  {formError}
                </p>
              )}

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
                  className="flex items-center gap-2 px-5 py-2.5 bg-white text-black text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
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
          <p className="text-neutral-600 font-mono text-sm mb-4">No rentals yet.</p>
          <button
            onClick={openCreate}
            className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 hover:text-white transition-colors"
          >
            Add the first one →
          </button>
        </div>
      ) : (
        <>
          {/* Column header */}
          <div className="hidden md:grid grid-cols-[40px_1fr_100px_110px_90px_40px_160px] gap-4 px-4 py-3 text-[9px] font-mono uppercase tracking-widest text-neutral-700 border-b border-white/5">
            <span></span>
            <span>Title</span>
            <span>Category</span>
            <span>Per Day</span>
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
                  <div className="grid grid-cols-1 md:grid-cols-[40px_1fr_100px_110px_90px_40px_160px] gap-4 items-center px-4 py-4 bg-neutral-900 border border-white/5 hover:border-white/10 transition-colors">

                    {/* Thumbnail */}
                    <div className="hidden md:block w-10 h-7 bg-neutral-800 flex-shrink-0 overflow-hidden">
                      {item.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.thumbnail_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-neutral-800" />
                      )}
                    </div>

                    {/* Title + brand/model */}
                    <div className="min-w-0">
                      <p className="text-sm font-mono text-white truncate leading-tight">{item.title}</p>
                      {(item.brand || item.model) && (
                        <p className="text-[10px] font-mono text-neutral-600 mt-0.5 truncate">
                          {[item.brand, item.model].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>

                    {/* Category */}
                    <span className="hidden md:block text-[10px] font-mono uppercase tracking-widest text-neutral-500 truncate">
                      {item.category}
                    </span>

                    {/* Price per day */}
                    <span className="hidden md:block text-[10px] font-mono text-neutral-500">
                      {item.price_per_day != null
                        ? `${item.currency} ${item.price_per_day.toLocaleString()}`
                        : '—'
                      }
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
            {items.length} rental{items.length !== 1 ? 's' : ''}
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
              className="px-4 py-2 bg-white text-black text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity"
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
