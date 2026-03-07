'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { Upload, X, Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';

const CATEGORIES = [
  { value: 'equipment', label: 'Equipment' },
  { value: 'services', label: 'Services' },
  { value: 'presets', label: 'Presets & LUTs' },
  { value: 'templates', label: 'Templates' },
  { value: 'stock', label: 'Stock Media' },
];

const PRICING_MODELS = [
  { value: 'fixed', label: 'Fixed Price' },
  { value: 'daily', label: 'Per Day' },
  { value: 'hourly', label: 'Per Hour' },
  { value: 'weekly', label: 'Per Week' },
  { value: 'monthly', label: 'Per Month' },
];

const CONDITIONS = [
  { value: 'new', label: 'New' },
  { value: 'like-new', label: 'Like New' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
];

export default function CreateListingPage() {
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('equipment');
  const [price, setPrice] = useState('');
  const [pricingModel, setPricingModel] = useState('fixed');
  const [condition, setCondition] = useState('good');
  const [features, setFeatures] = useState<string[]>([]);
  const [newFeature, setNewFeature] = useState('');
  const [images, setImages] = useState<{ url: string; public_id: string }[]>(
    [],
  );

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFeature = () => {
    const trimmed = newFeature.trim();
    if (trimmed && !features.includes(trimmed)) {
      setFeatures([...features, trimmed]);
      setNewFeature('');
    }
  };

  const removeFeature = (f: string) => {
    setFeatures(features.filter((x) => x !== f));
  };

  const handleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = e.target.files;
    if (!files?.length) return;

    setUploading(true);
    setError(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated.');

      for (const file of Array.from(files)) {
        const signRes = await fetch('/api/cloudinary/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            folder: `marketplace/${user.id}`,
          }),
        });
        const { signature, timestamp, api_key, cloud_name } =
          await signRes.json();

        const formData = new FormData();
        formData.append('file', file);
        formData.append('signature', signature);
        formData.append('timestamp', String(timestamp));
        formData.append('api_key', api_key);
        formData.append('folder', `marketplace/${user.id}`);

        const uploadRes = await fetch(
          `https://api.cloudinary.com/v1_1/${cloud_name}/image/upload`,
          { method: 'POST', body: formData },
        );
        const data = await uploadRes.json();

        if (data.secure_url) {
          setImages((prev) => [
            ...prev,
            { url: data.secure_url, public_id: data.public_id },
          ]);
        }
      }
    } catch {
      setError('Failed to upload images.');
    } finally {
      setUploading(false);
    }
  };

  const removeImage = async (publicId: string) => {
    setImages((prev) => prev.filter((img) => img.public_id !== publicId));
    // TODO: Call /api/cloudinary/delete to clean up from Cloudinary
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    if (!price || isNaN(Number(price))) {
      setError('A valid price is required.');
      return;
    }

    setSaving(true);

    const slug = title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    try {
      const res = await fetch('/api/marketplace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: category === 'services' ? 'service' : 'gear',
          title: title.trim(),
          slug,
          description: description.trim() || null,
          price: Number(price),
          pricing_model: pricingModel,
          currency: 'ZAR',
          category,
          condition: condition || null,
          thumbnail_url: images[0]?.url || null,
          cover_public_id: images[0]?.public_id || null,
          gallery: images.length > 1 ? images.slice(1) : null,
          features: features.length > 0 ? features : null,
          is_published: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create listing.');
      }

      const listing = await res.json();
      router.push(`/marketplace/${listing.slug}`);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0A0B] text-black dark:text-white pt-20 transition-colors duration-500">
      <div className="container mx-auto px-6 py-12 max-w-3xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">
            Marketplace
          </p>
          <h1 className="text-3xl font-display font-medium uppercase tracking-tight mb-2">
            Create Listing
          </h1>
          <div className="w-8 h-px bg-black dark:bg-white mt-4 mb-10" />

          <form onSubmit={handleSubmit} className="space-y-10">
            {/* Basic Info */}
            <div className="space-y-5">
              <Input
                label="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What are you selling?"
                required
              />

              <Textarea
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your listing in detail..."
                maxLength={2000}
                rows={6}
              />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <Select
                  label="Category"
                  options={CATEGORIES}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
                <Select
                  label="Condition"
                  options={CONDITIONS}
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                />
                <Select
                  label="Pricing Model"
                  options={PRICING_MODELS}
                  value={pricingModel}
                  onChange={(e) => setPricingModel(e.target.value)}
                />
              </div>

              <Input
                label="Price (ZAR)"
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
              />
            </div>

            {/* Features */}
            <div>
              <p className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">
                Features / Includes
              </p>
              <div className="flex flex-wrap gap-2 mb-3">
                {features.map((f) => (
                  <span
                    key={f}
                    className="inline-flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest border border-black/10 dark:border-white/10 px-2.5 py-1 text-neutral-600 dark:text-neutral-400"
                  >
                    {f}
                    <button
                      type="button"
                      onClick={() => removeFeature(f)}
                      className="text-neutral-400 hover:text-red-500 transition-colors"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    value={newFeature}
                    onChange={(e) => setNewFeature(e.target.value)}
                    placeholder="Add a feature..."
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addFeature();
                      }
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addFeature}
                >
                  <Plus className="w-3 h-3" />
                </Button>
              </div>
            </div>

            {/* Images */}
            <div>
              <p className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-3">
                Images
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-4">
                {images.map((img) => (
                  <div
                    key={img.public_id}
                    className="relative h-28 border border-black/10 dark:border-white/10 overflow-hidden group"
                  >
                    <Image
                      src={img.url}
                      alt=""
                      fill
                      className="object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(img.public_id)}
                      className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}

                {/* Upload trigger */}
                <label className="relative h-28 border border-dashed border-black/20 dark:border-white/20 flex flex-col items-center justify-center cursor-pointer hover:border-black dark:hover:border-white transition-colors">
                  <Upload className="w-5 h-5 text-neutral-400 mb-1" />
                  <span className="text-[9px] font-mono uppercase tracking-widest text-neutral-400">
                    {uploading ? 'Uploading...' : 'Add'}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageUpload}
                    disabled={uploading}
                    className="hidden"
                  />
                </label>
              </div>
              <p className="text-[9px] font-mono text-neutral-500">
                Upload up to 8 images. JPG, PNG or WebP.
              </p>
            </div>

            {/* Error */}
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="overflow-hidden"
              >
                <div className="bg-red-500/10 border border-red-500/30 px-4 py-3">
                  <p className="text-xs text-red-600 dark:text-red-400 font-mono leading-relaxed">
                    {error}
                  </p>
                </div>
              </motion.div>
            )}

            {/* Submit */}
            <div className="flex justify-end gap-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Publish Listing
              </Button>
            </div>
          </form>
        </motion.div>
      </div>
    </div>
  );
}
