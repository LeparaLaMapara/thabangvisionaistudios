'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import {
  Crop,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { uploadFile } from '@/lib/cloudinary/upload';
import type { PressArticle } from '@/lib/supabase/queries/press';

// ─── Cloudinary folder ────────────────────────────────────────────────────────

const PRESS_FOLDER = 'thabangvision_usecase/media/press';

// ─── Types ───────────────────────────────────────────────────────────────────

type Form = {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  cover_url: string;
  cover_public_id: string;
  author: string;
  category: string;
  published_at: string;
  is_published: boolean;
  is_featured: boolean;
};

const EMPTY: Form = {
  title: '',
  slug: '',
  content: '',
  excerpt: '',
  cover_url: '',
  cover_public_id: '',
  author: '',
  category: '',
  published_at: '',
  is_published: false,
  is_featured: false,
};

// ─── Cover image crop helpers ─────────────────────────────────────────────────

async function getCroppedImgBlob(
  imageSrc: string,
  croppedAreaPixels: Area,
): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', reject);
    img.src = imageSrc;
  });
  const canvas = document.createElement('canvas');
  canvas.width = croppedAreaPixels.width;
  canvas.height = croppedAreaPixels.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(
    image,
    croppedAreaPixels.x,
    croppedAreaPixels.y,
    croppedAreaPixels.width,
    croppedAreaPixels.height,
    0,
    0,
    croppedAreaPixels.width,
    croppedAreaPixels.height,
  );
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Canvas empty'))), 'image/jpeg', 0.92),
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminPressPage() {
  const [items, setItems] = useState<PressArticle[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cover image upload states
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const supabase = createClient();

  // ─── Fetch ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchArticles();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchArticles() {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('press')
      .select('*')
      .is('deleted_at', null)
      .order('published_at', { ascending: false, nullsFirst: false });

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setItems((data as PressArticle[]) ?? []);
    }
    setLoading(false);
  }

  // ─── Cover image dropzone ─────────────────────────────────────────────────

  const onDrop = useCallback((accepted: File[]) => {
    if (!accepted.length) return;
    const url = URL.createObjectURL(accepted[0]);
    setCropSrc(url);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    multiple: false,
  });

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const applyCrop = async () => {
    if (!cropSrc || !croppedAreaPixels) return;
    const blob = await getCroppedImgBlob(cropSrc, croppedAreaPixels);
    const preview = URL.createObjectURL(blob);
    setCoverPreview(preview);
    setCropSrc(null);
  };

  const uploadCover = async () => {
    if (!coverPreview) return;
    setUploading(true);
    try {
      const res = await fetch(coverPreview);
      const blob = await res.blob();
      const file = new File([blob], 'cover.jpg', { type: 'image/jpeg' });
      const asset = await uploadFile(file, PRESS_FOLDER, pct => setUploadProgress(pct));
      setForm(f => ({ ...f, cover_url: asset.url, cover_public_id: asset.public_id }));
      setCoverPreview(null);
      setUploadProgress(0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const removeCover = () => {
    setForm(f => ({ ...f, cover_url: '', cover_public_id: '' }));
    setCoverPreview(null);
    setCropSrc(null);
  };

  // ─── Form helpers ──────────────────────────────────────────────────────────

  const slugify = (title: string) =>
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY, published_at: new Date().toISOString().slice(0, 10) });
    setCoverPreview(null);
    setCropSrc(null);
    setShowForm(true);
  };

  const openEdit = (item: PressArticle) => {
    setEditingId(item.id);
    setForm({
      title: item.title,
      slug: item.slug,
      content: item.content ?? '',
      excerpt: item.excerpt ?? '',
      cover_url: item.cover_url ?? '',
      cover_public_id: item.cover_public_id ?? '',
      author: item.author ?? '',
      category: item.category ?? '',
      published_at: item.published_at ?? '',
      is_published: item.is_published,
      is_featured: item.is_featured,
    });
    setCoverPreview(null);
    setCropSrc(null);
    setShowForm(true);
  };

  const cancel = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY);
    setCoverPreview(null);
    setCropSrc(null);
  };

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  const save = async () => {
    if (!form.title.trim() || !form.slug.trim()) return;
    setSaving(true);
    setError(null);

    const payload = {
      title: form.title.trim(),
      slug: form.slug.trim(),
      content: form.content.trim() || null,
      excerpt: form.excerpt.trim() || null,
      cover_url: form.cover_url || null,
      cover_public_id: form.cover_public_id || null,
      author: form.author.trim() || null,
      category: form.category.trim() || null,
      published_at: form.published_at || null,
      is_published: form.is_published,
      is_featured: form.is_featured,
      updated_at: new Date().toISOString(),
    };

    if (editingId) {
      const { data, error: updateError } = await supabase
        .from('press')
        .update(payload)
        .eq('id', editingId)
        .select()
        .single();

      if (updateError) {
        setError(updateError.message);
      } else {
        setItems(prev =>
          prev.map(p => (p.id === editingId ? (data as PressArticle) : p)),
        );
        cancel();
      }
    } else {
      const { data, error: insertError } = await supabase
        .from('press')
        .insert(payload)
        .select()
        .single();

      if (insertError) {
        setError(insertError.message);
      } else {
        setItems(prev => [data as PressArticle, ...prev]);
        cancel();
      }
    }

    setSaving(false);
  };

  const softDelete = async (id: string) => {
    const { error: deleteError } = await supabase
      .from('press')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (deleteError) {
      setError(deleteError.message);
    } else {
      setItems(prev => prev.filter(p => p.id !== id));
    }
  };

  const togglePublish = async (item: PressArticle) => {
    const { data, error: updateError } = await supabase
      .from('press')
      .update({ is_published: !item.is_published, updated_at: new Date().toISOString() })
      .eq('id', item.id)
      .select()
      .single();

    if (updateError) {
      setError(updateError.message);
    } else {
      setItems(prev =>
        prev.map(p => (p.id === item.id ? (data as PressArticle) : p)),
      );
    }
  };

  const toggleFeatured = async (item: PressArticle) => {
    const { data, error: updateError } = await supabase
      .from('press')
      .update({ is_featured: !item.is_featured, updated_at: new Date().toISOString() })
      .eq('id', item.id)
      .select()
      .single();

    if (updateError) {
      setError(updateError.message);
    } else {
      setItems(prev =>
        prev.map(p => (p.id === item.id ? (data as PressArticle) : p)),
      );
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-10">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-600 mb-1">
            Admin
          </p>
          <h1 className="text-2xl font-display font-medium uppercase text-white">
            Press
          </h1>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-white text-black text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity"
        >
          <Plus className="w-3 h-3" /> New Article
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 px-4 py-3 bg-red-950 border border-red-700/40 text-red-400 text-xs font-mono">
          {error}
        </div>
      )}

      {/* Crop Modal */}
      {cropSrc && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-6">
          <div className="relative w-full max-w-2xl h-[400px] bg-neutral-900">
            <Cropper
              image={cropSrc}
              crop={crop}
              zoom={zoom}
              aspect={16 / 9}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          </div>
          <div className="flex gap-4 mt-6">
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={e => setZoom(Number(e.target.value))}
              className="w-40 accent-white"
            />
            <button
              onClick={applyCrop}
              className="flex items-center gap-2 px-5 py-2 bg-white text-black text-[10px] font-mono font-bold uppercase tracking-widest"
            >
              <Crop className="w-3 h-3" /> Apply Crop
            </button>
            <button
              onClick={() => setCropSrc(null)}
              className="px-5 py-2 border border-white/20 text-[10px] font-mono uppercase text-neutral-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="mb-10 bg-neutral-900 border border-white/10 p-6">
          <h2 className="text-xs font-mono uppercase tracking-widest text-white mb-6">
            {editingId ? 'Edit Article' : 'New Article'}
          </h2>

          {/* Cover image upload */}
          <div className="mb-6">
            <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">
              Cover Image
            </p>
            {form.cover_url ? (
              <div className="relative w-full max-w-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={form.cover_url}
                  alt="Cover"
                  className="w-full h-40 object-cover"
                />
                <button
                  onClick={removeCover}
                  className="absolute top-2 right-2 p-1 bg-black/70 border border-white/20 text-white hover:bg-red-950"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : coverPreview ? (
              <div className="relative w-full max-w-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={coverPreview}
                  alt="Preview"
                  className="w-full h-40 object-cover"
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={uploadCover}
                    disabled={uploading}
                    className="flex items-center gap-2 px-4 py-2 bg-white text-black text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 disabled:opacity-50"
                  >
                    {uploading ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <ImagePlus className="w-3 h-3" />
                    )}
                    {uploading ? `${uploadProgress}%` : 'Upload to Cloudinary'}
                  </button>
                  <button
                    onClick={removeCover}
                    className="px-4 py-2 border border-white/20 text-[10px] font-mono uppercase text-neutral-400"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <div
                {...getRootProps()}
                className={`border border-dashed p-8 text-center cursor-pointer transition-colors ${
                  isDragActive
                    ? 'border-white/40 bg-white/5'
                    : 'border-white/10 hover:border-white/20'
                }`}
              >
                <input {...getInputProps()} ref={fileInputRef} />
                <ImagePlus className="w-5 h-5 mx-auto mb-2 text-neutral-600" />
                <p className="text-[10px] font-mono text-neutral-600 uppercase tracking-widest">
                  Drop image here or click to browse
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <Field
              label="Title"
              value={form.title}
              onChange={v => {
                setForm(f => ({
                  ...f,
                  title: v,
                  slug: f.slug || slugify(v),
                }));
              }}
            />
            <Field
              label="Slug"
              value={form.slug}
              onChange={v => setForm(f => ({ ...f, slug: slugify(v) }))}
            />
            <Field
              label="Author"
              value={form.author}
              onChange={v => setForm(f => ({ ...f, author: v }))}
            />
            <Field
              label="Category"
              value={form.category}
              onChange={v => setForm(f => ({ ...f, category: v }))}
            />
            <Field
              label="Published At (YYYY-MM-DD)"
              value={form.published_at}
              onChange={v => setForm(f => ({ ...f, published_at: v }))}
            />
          </div>
          <div className="mb-4">
            <label className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
              Excerpt
            </label>
            <textarea
              value={form.excerpt}
              onChange={e => setForm(f => ({ ...f, excerpt: e.target.value }))}
              rows={2}
              className="w-full bg-neutral-950 border border-white/10 text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-white/30 resize-none"
            />
          </div>
          <div className="mb-4">
            <label className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
              Content
            </label>
            <textarea
              value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              rows={8}
              className="w-full bg-neutral-950 border border-white/10 text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-white/30 resize-none"
            />
          </div>
          <div className="flex items-center gap-6 mb-6">
            <label className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-400 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_published}
                onChange={e => setForm(f => ({ ...f, is_published: e.target.checked }))}
                className="accent-white"
              />
              Published
            </label>
            <label className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-400 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_featured}
                onChange={e => setForm(f => ({ ...f, is_featured: e.target.checked }))}
                className="accent-white"
              />
              Featured
            </label>
          </div>
          <div className="flex gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-white text-black text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity disabled:opacity-50"
            >
              {saving && <Loader2 className="w-3 h-3 animate-spin" />}
              Save
            </button>
            <button
              onClick={cancel}
              className="px-5 py-2 border border-white/20 text-[10px] font-mono uppercase tracking-widest text-neutral-400 hover:text-white hover:border-white/40 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20 gap-2 text-neutral-600 font-mono text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      ) : items.length === 0 ? (
        <p className="text-neutral-600 font-mono text-sm text-center py-20">
          No articles yet. Create one above.
        </p>
      ) : (
        <div className="space-y-px">
          {items.map(item => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-4 bg-neutral-900 border border-white/5 px-6 py-4 hover:border-white/10 transition-colors"
            >
              <div className="min-w-0 flex items-center gap-4">
                {item.cover_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.cover_url}
                    alt={item.title}
                    className="w-12 h-8 object-cover flex-shrink-0 grayscale"
                  />
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        item.is_published ? 'bg-emerald-400' : 'bg-neutral-600'
                      }`}
                    />
                    <p className="text-sm font-mono text-white truncate">{item.title}</p>
                    {item.is_featured && (
                      <Star className="w-3 h-3 text-yellow-500 flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-[10px] font-mono text-neutral-600 pl-[18px]">
                    /{item.slug}
                    {item.published_at ? ` · ${item.published_at}` : ''}
                    {item.author ? ` · ${item.author}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <ActionBtn
                  onClick={() => toggleFeatured(item)}
                  title={item.is_featured ? 'Unfeature' : 'Feature'}
                >
                  <Star className={`w-3.5 h-3.5 ${item.is_featured ? 'text-yellow-500' : ''}`} />
                </ActionBtn>
                <ActionBtn
                  onClick={() => togglePublish(item)}
                  title={item.is_published ? 'Unpublish' : 'Publish'}
                >
                  {item.is_published ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </ActionBtn>
                <ActionBtn onClick={() => openEdit(item)} title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </ActionBtn>
                <ActionBtn
                  onClick={() => softDelete(item.id)}
                  title="Delete"
                  danger
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </ActionBtn>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-neutral-950 border border-white/10 text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-white/30"
      />
    </div>
  );
}

function ActionBtn({
  onClick,
  title,
  danger = false,
  children,
}: {
  onClick: () => void;
  title: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-2 border transition-colors ${
        danger
          ? 'border-red-900/40 text-red-600 hover:border-red-500/40 hover:text-red-400'
          : 'border-white/10 text-neutral-500 hover:border-white/30 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}
