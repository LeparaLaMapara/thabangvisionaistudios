'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Plus,
  Package,
  Pencil,
  Trash2,
  ShieldCheck,
  Loader2,
  X,
  ImagePlus,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { uploadFile, type CloudinaryAsset } from '@/lib/cloudinary/upload';
import { STUDIO } from '@/lib/constants';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

type Listing = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  category: string;
  price_per_day: number | null;
  condition: string | null;
  location: string | null;
  thumbnail_url: string | null;
  gallery: { url: string; public_id: string }[] | null;
  is_published: boolean;
  created_at: string;
  deleted_at: string | null;
};

type ListingForm = {
  title: string;
  description: string;
  category: string;
  price_per_day: string;
  condition: string;
  location: string;
};

const EMPTY_FORM: ListingForm = {
  title: '',
  description: '',
  category: '',
  price_per_day: '',
  condition: '',
  location: '',
};

const CATEGORIES = [
  'cameras',
  'lenses',
  'lighting',
  'audio',
  'grip',
  'accessories',
  'other',
];

const CONDITIONS = ['new', 'like-new', 'good', 'fair'];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

export default function ListingsPage() {
  const [verificationStatus, setVerificationStatus] =
    useState<VerificationStatus | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ListingForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<CloudinaryAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const supabase = createClient();

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function init() {
    setLoading(true);
    // Check verification status
    try {
      const res = await fetch('/api/verifications');
      if (res.ok) {
        const data = await res.json();
        setVerificationStatus(data.status);
      } else {
        setVerificationStatus('unverified');
      }
    } catch {
      setVerificationStatus('unverified');
    }

    // Fetch listings
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data, error: fetchError } = await supabase
        .from('listings')
        .select('*')
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (fetchError) {
        setError(fetchError.message);
      } else {
        setListings((data as Listing[]) ?? []);
      }
    }

    setLoading(false);
  }

  // ── Form helpers ────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setImages([]);
    setShowForm(true);
  };

  const openEdit = (listing: Listing) => {
    setEditingId(listing.id);
    setForm({
      title: listing.title,
      description: listing.description ?? '',
      category: listing.category,
      price_per_day: listing.price_per_day?.toString() ?? '',
      condition: listing.condition ?? '',
      location: listing.location ?? '',
    });
    setImages(listing.gallery ?? (listing.thumbnail_url ? [{ url: listing.thumbnail_url, public_id: '' }] : []));
    setShowForm(true);
  };

  const cancel = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setImages([]);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const remaining = STUDIO.platform.maxListingImages - images.length;
    if (remaining <= 0) {
      setError('Maximum 5 images per listing.');
      return;
    }

    const toUpload = Array.from(files).slice(0, remaining);
    setUploading(true);
    setUploadProgress(0);
    setError(null);

    try {
      let done = 0;
      const uploaded: CloudinaryAsset[] = [];
      for (const file of toUpload) {
        const asset = await uploadFile(
          file,
          'thabangvision_usecase/media/listings',
          (pct) => setUploadProgress(Math.round((done / toUpload.length) * 100 + pct / toUpload.length)),
        );
        uploaded.push(asset);
        done++;
      }
      setImages((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      // Reset input so the same file can be re-selected
      e.target.value = '';
    }
  };

  const removeImage = async (index: number) => {
    const img = images[index];
    setImages((prev) => prev.filter((_, i) => i !== index));
    // Delete from Cloudinary if we have a public_id
    if (img.public_id) {
      fetch('/api/cloudinary/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_id: img.public_id }),
      }).catch(() => {});
    }
  };

  // ── CRUD ────────────────────────────────────────────────────────────────────

  const save = async () => {
    if (!form.title.trim()) {
      setError('Title is required.');
      return;
    }
    if (!form.category) {
      setError('Category is required.');
      return;
    }
    if (images.length === 0) {
      setError('At least one image is required.');
      return;
    }

    setSaving(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError('Not authenticated.');
      setSaving(false);
      return;
    }

    const payload = {
      title: form.title.trim(),
      slug: slugify(form.title),
      description: form.description.trim() || null,
      category: form.category,
      price_per_day: form.price_per_day ? parseFloat(form.price_per_day) : null,
      condition: form.condition || null,
      location: form.location.trim() || null,
      thumbnail_url: images[0]?.url ?? null,
      cover_public_id: images[0]?.public_id ?? null,
      gallery: images.length > 0 ? images : null,
      type: 'gear' as const,
      pricing_model: 'daily' as const,
      currency: STUDIO.currency.code,
      is_published: true,
      updated_at: new Date().toISOString(),
    };

    if (editingId) {
      const { data, error: updateError } = await supabase
        .from('listings')
        .update(payload)
        .eq('id', editingId)
        .select()
        .single();

      if (updateError) {
        setError(updateError.message);
      } else {
        setListings((prev) =>
          prev.map((l) => (l.id === editingId ? (data as Listing) : l)),
        );
        cancel();
      }
    } else {
      const { data, error: insertError } = await supabase
        .from('listings')
        .insert({ ...payload, user_id: user.id })
        .select()
        .single();

      if (insertError) {
        setError(insertError.message);
      } else {
        setListings((prev) => [data as Listing, ...prev]);
        cancel();
      }
    }

    setSaving(false);
  };

  const softDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this listing?')) return;

    const { error: deleteError } = await supabase
      .from('listings')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (deleteError) {
      setError(deleteError.message);
    } else {
      setListings((prev) => prev.filter((l) => l.id !== id));
    }
  };

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-2 text-neutral-500 font-mono text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading...
      </div>
    );
  }

  // ── Not verified ────────────────────────────────────────────────────────────

  if (verificationStatus !== 'verified') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <h2 className="text-lg font-display font-medium uppercase text-black dark:text-white mb-6">
          List Your Gear
        </h2>
        <EmptyState
          title="Verify Your Identity to List Gear"
          description="To list your equipment for rent, you must first complete identity verification."
          action={{ label: 'Go to Verification', href: '/dashboard/verification' }}
          icon={<ShieldCheck className="w-10 h-10" />}
        />
      </motion.div>
    );
  }

  // ── Verified — show listings ────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-display font-medium uppercase text-black dark:text-white">
          List Your Gear
        </h2>
        <Button size="sm" onClick={openCreate}>
          <Plus className="w-3 h-3" />
          List New Gear
        </Button>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-700/40 text-red-600 dark:text-red-400 text-xs font-mono">
          {error}
        </div>
      )}

      {/* ── Inline Form ──────────────────────────────────────────────────── */}
      {showForm && (
        <Card className="p-6 mb-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xs font-mono uppercase tracking-widest text-black dark:text-white">
              {editingId ? 'Edit Listing' : 'New Listing'}
            </h3>
            <button
              onClick={cancel}
              className="text-neutral-400 hover:text-black dark:hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {/* Title */}
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
                Title
              </label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Sony A7 III Body"
                className="w-full bg-neutral-100 dark:bg-neutral-950 border border-black/10 dark:border-white/10 text-black dark:text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-black/30 dark:focus:border-white/30"
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
                Category
              </label>
              <select
                value={form.category}
                onChange={(e) =>
                  setForm((f) => ({ ...f, category: e.target.value }))
                }
                className="w-full bg-neutral-100 dark:bg-neutral-950 border border-black/10 dark:border-white/10 text-black dark:text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-black/30 dark:focus:border-white/30"
              >
                <option value="">-- Select --</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            {/* Price per day */}
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
                Price per Day ({STUDIO.currency.code})
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.price_per_day}
                onChange={(e) =>
                  setForm((f) => ({ ...f, price_per_day: e.target.value }))
                }
                placeholder="e.g. 500"
                className="w-full bg-neutral-100 dark:bg-neutral-950 border border-black/10 dark:border-white/10 text-black dark:text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-black/30 dark:focus:border-white/30"
              />
            </div>

            {/* Condition */}
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
                Condition
              </label>
              <select
                value={form.condition}
                onChange={(e) =>
                  setForm((f) => ({ ...f, condition: e.target.value }))
                }
                className="w-full bg-neutral-100 dark:bg-neutral-950 border border-black/10 dark:border-white/10 text-black dark:text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-black/30 dark:focus:border-white/30"
              >
                <option value="">-- Select --</option>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1).replace('-', ' ')}
                  </option>
                ))}
              </select>
            </div>

            {/* Location */}
            <div className="md:col-span-2">
              <label className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
                Location
              </label>
              <input
                type="text"
                value={form.location}
                onChange={(e) =>
                  setForm((f) => ({ ...f, location: e.target.value }))
                }
                placeholder="e.g. Johannesburg, Gauteng"
                className="w-full bg-neutral-100 dark:bg-neutral-950 border border-black/10 dark:border-white/10 text-black dark:text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-black/30 dark:focus:border-white/30"
              />
            </div>
          </div>

          {/* Description */}
          <div className="mb-6">
            <label className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
              Description
            </label>
            <textarea
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              rows={3}
              placeholder="Describe your equipment, what's included, any notes..."
              className="w-full bg-neutral-100 dark:bg-neutral-950 border border-black/10 dark:border-white/10 text-black dark:text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-black/30 dark:focus:border-white/30 resize-none placeholder:text-neutral-400 dark:placeholder:text-neutral-700"
            />
          </div>

          {/* Images */}
          <div className="mb-6">
            <label className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
              Images ({images.length}/{STUDIO.platform.maxListingImages})
            </label>
            <div className="flex flex-wrap gap-3">
              {images.map((img, i) => (
                <div
                  key={img.public_id || i}
                  className="relative w-20 h-20 bg-neutral-100 dark:bg-neutral-900 border border-black/10 dark:border-white/10 overflow-hidden group"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  {i === 0 && (
                    <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-[8px] text-white text-center font-mono uppercase py-0.5">
                      Cover
                    </span>
                  )}
                </div>
              ))}
              {images.length < STUDIO.platform.maxListingImages && (
                <label className="w-20 h-20 border border-dashed border-black/20 dark:border-white/20 flex flex-col items-center justify-center cursor-pointer hover:border-black/40 dark:hover:border-white/40 transition-colors">
                  {uploading ? (
                    <>
                      <Loader2 className="w-4 h-4 text-neutral-400 animate-spin" />
                      <span className="text-[9px] font-mono text-neutral-400 mt-1">{uploadProgress}%</span>
                    </>
                  ) : (
                    <>
                      <ImagePlus className="w-4 h-4 text-neutral-400" />
                      <span className="text-[9px] font-mono text-neutral-400 mt-1">Add</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleImageUpload}
                    disabled={uploading}
                  />
                </label>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <Button onClick={save} loading={saving} disabled={uploading || images.length === 0}>
              {editingId ? 'Update Listing' : 'Create Listing'}
            </Button>
            <Button variant="outline" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* ── Listings ─────────────────────────────────────────────────────── */}
      {listings.length === 0 && !showForm ? (
        <EmptyState
          title="No Listings Yet"
          description="List your first piece of gear to start earning rental income."
          action={{ label: 'List New Gear', onClick: openCreate }}
          icon={<Package className="w-8 h-8" />}
        />
      ) : (
        <div className="space-y-3">
          {listings.map((listing) => (
            <Card key={listing.id} hover className="p-0 overflow-hidden">
              <div className="flex items-stretch">
                {listing.thumbnail_url ? (
                  <div className="w-20 h-20 flex-shrink-0 bg-neutral-100 dark:bg-neutral-900">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={listing.thumbnail_url}
                      alt={listing.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="w-20 h-20 flex-shrink-0 bg-neutral-100 dark:bg-neutral-900 flex items-center justify-center">
                    <Package className="w-6 h-6 text-neutral-300 dark:text-neutral-700" />
                  </div>
                )}
                <div className="flex items-start justify-between gap-4 flex-1 min-w-0 p-5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-medium text-black dark:text-white truncate">
                        {listing.title}
                      </h3>
                      <Badge variant={listing.is_published ? 'success' : 'warning'}>
                        {listing.is_published ? 'Active' : 'Draft'}
                      </Badge>
                    </div>
                    <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
                      {listing.category}
                      {listing.condition ? ` / ${listing.condition}` : ''}
                      {listing.location ? ` / ${listing.location}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0">
                    {listing.price_per_day !== null && (
                      <p className="text-sm font-mono font-bold text-black dark:text-white whitespace-nowrap">
                        {STUDIO.currency.symbol}{listing.price_per_day}/day
                      </p>
                    )}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEdit(listing)}
                        title="Edit"
                        className="p-2 border border-black/10 dark:border-white/10 text-neutral-500 hover:border-black/30 dark:hover:border-white/30 hover:text-black dark:hover:text-white transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => softDelete(listing.id)}
                        title="Delete"
                        className="p-2 border border-red-900/20 dark:border-red-900/40 text-red-500 dark:text-red-600 hover:border-red-500/40 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </motion.div>
  );
}
