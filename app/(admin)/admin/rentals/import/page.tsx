'use client';

import { useCallback, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import Link from 'next/link';
import {
  AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronUp,
  FileUp, Loader2, Package, Upload, X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { STUDIO } from '@/lib/constants';
import {
  uploadFile,
  type CloudinaryAsset,
} from '@/lib/cloudinary/upload';

// ─── Types ──────────────────────────────────────────────────────────────────────

type ExtractedItem = {
  title: string;
  category: string;
  sub_category: string | null;
  brand: string | null;
  model: string | null;
  description: string | null;
  features: string[];
  daily_rate: number;
  weekly_rate: number;
  deposit: number;
  tags: string[];
};

type ImportItem = ExtractedItem & {
  _id: string;
  _selected: boolean;
  _expanded: boolean;
  _status: 'ready' | 'complete' | 'duplicate' | 'imported' | 'skipped';
  _duplicateAction: 'skip' | 'update' | 'replace' | null;
  _duplicateId: string | null;
  _gallery: CloudinaryAsset[];
};

// ─── Constants ──────────────────────────────────────────────────────────────────

const VALID_CATEGORIES = [
  { value: 'cameras-optics', label: 'Cameras & Optics' },
  { value: 'audio', label: 'Audio' },
  { value: 'lighting-power', label: 'Lighting & Power' },
  { value: 'grip-motion', label: 'Grip & Motion' },
  { value: 'data-storage', label: 'Data & Storage' },
  { value: 'crew-services', label: 'Crew Services' },
  { value: 'specialized-solutions', label: 'Specialized Solutions' },
  { value: 'aerial-support', label: 'Aerial Support' },
  { value: 'sound-reinforcement', label: 'Sound Reinforcement' },
];

function autoSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function ImportRateCardPage() {
  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);

  // Items state
  const [items, setItems] = useState<ImportItem[]>([]);

  // Import state
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; skipped: number } | null>(null);

  // ── PDF upload & extraction ────────────────────────────────────────────────

  const onDrop = useCallback(async (accepted: File[]) => {
    const file = accepted[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      setUploadError('Only PDF files are accepted.');
      return;
    }

    setUploading(true);
    setUploadError(null);
    setPdfName(file.name);
    setItems([]);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/admin/import-ratecard', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setUploadError(data.error ?? 'Extraction failed.');
        setUploading(false);
        return;
      }

      setPageCount(data.pageCount ?? 0);

      // Convert extracted items to ImportItems
      const importItems: ImportItem[] = (data.items as ExtractedItem[]).map((item) => ({
        ...item,
        _id: uid(),
        _selected: true,
        _expanded: false,
        _status: 'ready' as const,
        _duplicateAction: null,
        _duplicateId: null,
        _gallery: [],
      }));

      setItems(importItems);
    } catch {
      setUploadError('Network error. Please try again.');
    } finally {
      setUploading(false);
    }
  }, []);

  const dropzone = useDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    multiple: false,
    disabled: uploading,
    onDrop,
  });

  // ── Item helpers ───────────────────────────────────────────────────────────

  const updateItem = (id: string, patch: Partial<ImportItem>) => {
    setItems((prev) => prev.map((it) => (it._id === id ? { ...it, ...patch } : it)));
  };

  const toggleSelect = (id: string) => {
    setItems((prev) => prev.map((it) => (it._id === id ? { ...it, _selected: !it._selected } : it)));
  };

  const toggleExpand = (id: string) => {
    setItems((prev) => prev.map((it) => (it._id === id ? { ...it, _expanded: !it._expanded } : it)));
  };

  const selectAll = items.length > 0 && items.every((it) => it._selected);
  const toggleSelectAll = () => {
    const next = !selectAll;
    setItems((prev) => prev.map((it) => ({ ...it, _selected: next })));
  };

  // ── Photo upload per item ──────────────────────────────────────────────────

  const galInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const handleGalleryUpload = async (itemId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const item = items.find((it) => it._id === itemId);
    if (!item) return;

    const folder = `smart-rentals/${item.category}`;
    const uploaded: CloudinaryAsset[] = [];

    for (const file of Array.from(files)) {
      try {
        const asset = await uploadFile(file, folder);
        uploaded.push(asset);
      } catch (err) {
        console.error('Gallery upload failed:', err);
      }
    }

    if (uploaded.length > 0) {
      updateItem(itemId, {
        _gallery: [...item._gallery, ...uploaded],
        _status: 'complete',
      });
    }
  };

  // ── Duplicate check + import ───────────────────────────────────────────────

  const doImport = async () => {
    const selected = items.filter((it) => it._selected && it._status !== 'imported' && it._status !== 'skipped');
    if (selected.length === 0) return;

    setImporting(true);
    setImportResult(null);

    const supabase = createClient();
    let successCount = 0;
    let skipCount = 0;

    for (const item of selected) {
      const slug = autoSlug(item.title);

      // Check for duplicates
      const { data: existing } = await supabase
        .from('smart_rentals')
        .select('id, title, slug')
        .or(`slug.eq.${slug},title.ilike.${item.title}`)
        .is('deleted_at', null)
        .limit(1);

      const duplicate = existing && existing.length > 0 ? existing[0] : null;

      if (duplicate) {
        // If already handled with a duplicate action, use it
        if (item._duplicateAction === 'skip') {
          updateItem(item._id, { _status: 'skipped' });
          skipCount++;
          continue;
        }

        if (item._duplicateAction === 'update') {
          // Update price only
          await supabase
            .from('smart_rentals')
            .update({
              price_per_day: item.daily_rate,
              price_per_week: item.weekly_rate,
              deposit_amount: item.deposit,
              updated_at: new Date().toISOString(),
            })
            .eq('id', duplicate.id);

          updateItem(item._id, { _status: 'imported' });
          successCount++;
          continue;
        }

        if (item._duplicateAction === 'replace') {
          // Soft-delete existing, then insert new
          await supabase
            .from('smart_rentals')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', duplicate.id);
        }

        if (!item._duplicateAction) {
          // Mark as duplicate — user must choose
          updateItem(item._id, {
            _status: 'duplicate',
            _duplicateId: duplicate.id,
          });
          skipCount++;
          continue;
        }
      }

      // Insert new rental
      const gallery = item._gallery.length > 0 ? item._gallery : null;
      const thumbnailUrl = item._gallery[0]?.url ?? null;
      const coverPublicId = item._gallery[0]?.public_id ?? null;

      const payload = {
        title: item.title,
        slug,
        category: item.category,
        sub_category: item.sub_category,
        brand: item.brand,
        model: item.model,
        description: item.description,
        features: item.features.length > 0 ? item.features : null,
        tags: item.tags.length > 0 ? item.tags : null,
        price_per_day: item.daily_rate,
        price_per_week: item.weekly_rate,
        deposit_amount: item.deposit,
        currency: STUDIO.currency.code,
        thumbnail_url: thumbnailUrl,
        cover_public_id: coverPublicId,
        gallery,
        is_published: false,
        is_available: true,
        quantity: 1,
        owner_type: 'studio',
      };

      const { error } = await supabase.from('smart_rentals').insert(payload);

      if (error) {
        console.error(`[import] Failed to insert "${item.title}":`, error.message);
        skipCount++;
      } else {
        updateItem(item._id, { _status: 'imported' });
        successCount++;
      }
    }

    setImportResult({ success: successCount, skipped: skipCount });
    setImporting(false);
  };

  // ── Counts ─────────────────────────────────────────────────────────────────

  const selectedCount = items.filter((it) => it._selected && it._status !== 'imported' && it._status !== 'skipped').length;
  const duplicateCount = items.filter((it) => it._status === 'duplicate').length;
  const importedCount = items.filter((it) => it._status === 'imported').length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-10">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/admin/rentals"
          className="text-neutral-500 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-xl font-display font-medium text-white uppercase tracking-widest">
            Import Rate Card
          </h1>
          <p className="text-[10px] font-mono text-neutral-600 uppercase tracking-widest mt-1">
            Upload a PDF rate card — AI extracts items for review
          </p>
        </div>
      </div>

      {/* ── Upload area ─────────────────────────────────────────────────────── */}
      {items.length === 0 && (
        <div
          {...dropzone.getRootProps()}
          className={`border-2 border-dashed rounded-lg p-16 text-center transition-colors cursor-pointer ${
            dropzone.isDragActive
              ? 'border-[#D4A843] bg-[#D4A843]/5'
              : 'border-white/10 hover:border-white/20 bg-neutral-900/50'
          }`}
        >
          <input {...dropzone.getInputProps()} />

          {uploading ? (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="w-10 h-10 text-[#D4A843] animate-spin" />
              <p className="text-sm text-neutral-400">
                Extracting items from <span className="text-white">{pdfName}</span>...
              </p>
              <p className="text-[10px] font-mono text-neutral-600">
                AI is reading the rate card. This may take 10–30 seconds.
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <FileUp className="w-10 h-10 text-neutral-600" />
              <p className="text-sm text-neutral-400">
                Drop your rate card PDF here, or <span className="text-[#D4A843]">browse</span>
              </p>
              <p className="text-[10px] font-mono text-neutral-600">
                PDF only — AI will extract all rental items for review
              </p>
            </div>
          )}
        </div>
      )}

      {uploadError && (
        <div className="mt-4 flex items-center gap-2 text-red-400 text-xs font-mono bg-red-500/10 border border-red-500/20 px-4 py-3">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {uploadError}
        </div>
      )}

      {/* ── Review table ────────────────────────────────────────────────────── */}
      {items.length > 0 && (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6 bg-neutral-900/50 border border-white/5 px-4 py-3">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectAll}
                  onChange={toggleSelectAll}
                  className="accent-[#D4A843] w-3.5 h-3.5"
                />
                <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400">
                  Select All
                </span>
              </label>
              <span className="text-[10px] font-mono text-neutral-600">
                {items.length} items extracted from {pdfName} ({pageCount} page{pageCount !== 1 ? 's' : ''})
              </span>
            </div>

            <div className="flex items-center gap-3">
              {duplicateCount > 0 && (
                <span className="text-[10px] font-mono text-amber-400">
                  {duplicateCount} duplicate{duplicateCount !== 1 ? 's' : ''} found
                </span>
              )}
              {importedCount > 0 && (
                <span className="text-[10px] font-mono text-emerald-400">
                  {importedCount} imported
                </span>
              )}

              {/* Re-upload */}
              <button
                type="button"
                onClick={() => { setItems([]); setPdfName(null); setImportResult(null); }}
                className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 hover:text-white transition-colors"
              >
                Re-upload
              </button>

              {/* Import button */}
              <button
                type="button"
                onClick={doImport}
                disabled={importing || selectedCount === 0}
                className={`flex items-center gap-2 px-5 py-2 text-[10px] font-mono uppercase tracking-widest transition-colors ${
                  importing || selectedCount === 0
                    ? 'bg-neutral-800 text-neutral-600 cursor-not-allowed'
                    : 'bg-[#D4A843] text-black hover:bg-[#E8C96A] cursor-pointer'
                }`}
              >
                {importing ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> Importing...</>
                ) : (
                  <><Upload className="w-3 h-3" /> Import Selected ({selectedCount})</>
                )}
              </button>
            </div>
          </div>

          {/* Success banner */}
          {importResult && (
            <div className="mb-6 flex items-center gap-2 text-emerald-400 text-xs font-mono bg-emerald-500/10 border border-emerald-500/20 px-4 py-3">
              <Check className="w-3.5 h-3.5 flex-shrink-0" />
              {importResult.success} item{importResult.success !== 1 ? 's' : ''} imported.
              {importResult.skipped > 0 && ` ${importResult.skipped} skipped.`}
              {' '}Add photos and publish from the{' '}
              <Link href="/admin/rentals" className="text-[#D4A843] underline underline-offset-2">
                rentals page
              </Link>.
            </div>
          )}

          {/* Items list */}
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item._id}
                className={`border transition-colors ${
                  item._status === 'imported'
                    ? 'border-emerald-500/20 bg-emerald-500/5'
                    : item._status === 'duplicate'
                      ? 'border-amber-500/20 bg-amber-500/5'
                      : item._status === 'skipped'
                        ? 'border-neutral-800 bg-neutral-900/30 opacity-50'
                        : 'border-white/5 bg-neutral-900/50'
                }`}
              >
                {/* Row summary */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={item._selected}
                    onChange={() => toggleSelect(item._id)}
                    disabled={item._status === 'imported' || item._status === 'skipped'}
                    className="accent-[#D4A843] w-3.5 h-3.5 flex-shrink-0"
                  />

                  {/* Thumbnail preview */}
                  <div className="w-10 h-10 bg-neutral-800 rounded flex-shrink-0 flex items-center justify-center overflow-hidden">
                    {item._gallery.length > 0 ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item._gallery[0].url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Package className="w-4 h-4 text-neutral-600" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-6 gap-1 md:gap-4 items-center">
                    <div className="md:col-span-2 truncate">
                      <span className="text-sm text-white font-medium">{item.title}</span>
                    </div>
                    <span className="text-[10px] font-mono text-neutral-500 uppercase truncate">
                      {VALID_CATEGORIES.find((c) => c.value === item.category)?.label ?? item.category}
                    </span>
                    <span className="text-[10px] font-mono text-neutral-400 truncate">
                      {[item.brand, item.model].filter(Boolean).join(' ') || '—'}
                    </span>
                    <span className="text-sm font-mono text-white">
                      {STUDIO.currency.symbol}{item.daily_rate.toLocaleString()}<span className="text-neutral-600">/day</span>
                    </span>
                    <span className="text-[10px] font-mono text-neutral-500">
                      Dep: {STUDIO.currency.symbol}{item.deposit.toLocaleString()}
                    </span>
                  </div>

                  {/* Status badge */}
                  <div className="flex-shrink-0 w-20 text-right">
                    {item._status === 'imported' && (
                      <span className="text-[9px] font-mono uppercase tracking-widest text-emerald-400">Imported</span>
                    )}
                    {item._status === 'duplicate' && (
                      <span className="text-[9px] font-mono uppercase tracking-widest text-amber-400">Duplicate</span>
                    )}
                    {item._status === 'skipped' && (
                      <span className="text-[9px] font-mono uppercase tracking-widest text-neutral-600">Skipped</span>
                    )}
                    {item._status === 'ready' && (
                      <span className="text-[9px] font-mono uppercase tracking-widest text-neutral-500">Ready</span>
                    )}
                    {item._status === 'complete' && (
                      <span className="text-[9px] font-mono uppercase tracking-widest text-blue-400">Complete</span>
                    )}
                  </div>

                  {/* Expand toggle */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(item._id)}
                    className="text-neutral-500 hover:text-white transition-colors flex-shrink-0"
                  >
                    {item._expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>

                {/* Duplicate actions */}
                {item._status === 'duplicate' && !item._duplicateAction && (
                  <div className="px-4 pb-3 flex items-center gap-3 border-t border-amber-500/10 pt-3 mx-4">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    <span className="text-xs text-amber-300 flex-1">
                      &quot;{item.title}&quot; already exists.
                    </span>
                    <button
                      type="button"
                      onClick={() => updateItem(item._id, { _duplicateAction: 'skip', _status: 'skipped' })}
                      className="text-[9px] font-mono uppercase tracking-widest text-neutral-400 hover:text-white px-3 py-1 border border-white/10 transition-colors"
                    >
                      Skip
                    </button>
                    <button
                      type="button"
                      onClick={() => updateItem(item._id, { _duplicateAction: 'update', _selected: true })}
                      className="text-[9px] font-mono uppercase tracking-widest text-amber-400 hover:text-amber-300 px-3 py-1 border border-amber-500/20 transition-colors"
                    >
                      Update Price
                    </button>
                    <button
                      type="button"
                      onClick={() => updateItem(item._id, { _duplicateAction: 'replace', _selected: true })}
                      className="text-[9px] font-mono uppercase tracking-widest text-red-400 hover:text-red-300 px-3 py-1 border border-red-500/20 transition-colors"
                    >
                      Replace
                    </button>
                  </div>
                )}

                {/* Expanded detail / edit */}
                {item._expanded && (
                  <div className="px-4 pb-4 pt-2 border-t border-white/5 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Title */}
                      <div>
                        <label className="text-[9px] font-mono uppercase tracking-widest text-neutral-600 block mb-1">Title</label>
                        <input
                          type="text"
                          value={item.title}
                          onChange={(e) => updateItem(item._id, { title: e.target.value })}
                          className="w-full bg-neutral-900 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-[#D4A843]/50"
                        />
                      </div>

                      {/* Category */}
                      <div>
                        <label className="text-[9px] font-mono uppercase tracking-widest text-neutral-600 block mb-1">Category</label>
                        <select
                          value={item.category}
                          onChange={(e) => updateItem(item._id, { category: e.target.value })}
                          className="w-full bg-neutral-900 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-[#D4A843]/50"
                        >
                          {VALID_CATEGORIES.map((c) => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </select>
                      </div>

                      {/* Sub-category */}
                      <div>
                        <label className="text-[9px] font-mono uppercase tracking-widest text-neutral-600 block mb-1">Sub-category</label>
                        <input
                          type="text"
                          value={item.sub_category ?? ''}
                          onChange={(e) => updateItem(item._id, { sub_category: e.target.value || null })}
                          className="w-full bg-neutral-900 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-[#D4A843]/50"
                        />
                      </div>

                      {/* Brand */}
                      <div>
                        <label className="text-[9px] font-mono uppercase tracking-widest text-neutral-600 block mb-1">Brand</label>
                        <input
                          type="text"
                          value={item.brand ?? ''}
                          onChange={(e) => updateItem(item._id, { brand: e.target.value || null })}
                          className="w-full bg-neutral-900 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-[#D4A843]/50"
                        />
                      </div>

                      {/* Model */}
                      <div>
                        <label className="text-[9px] font-mono uppercase tracking-widest text-neutral-600 block mb-1">Model</label>
                        <input
                          type="text"
                          value={item.model ?? ''}
                          onChange={(e) => updateItem(item._id, { model: e.target.value || null })}
                          className="w-full bg-neutral-900 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-[#D4A843]/50"
                        />
                      </div>

                      {/* Daily Rate */}
                      <div>
                        <label className="text-[9px] font-mono uppercase tracking-widest text-neutral-600 block mb-1">Daily Rate ({STUDIO.currency.code})</label>
                        <input
                          type="number"
                          value={item.daily_rate}
                          onChange={(e) => {
                            const daily = Number(e.target.value) || 0;
                            updateItem(item._id, {
                              daily_rate: daily,
                              weekly_rate: Math.round(daily * 2.5),
                              deposit: Math.round(daily * 0.5),
                            });
                          }}
                          className="w-full bg-neutral-900 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-[#D4A843]/50"
                        />
                      </div>

                      {/* Weekly Rate */}
                      <div>
                        <label className="text-[9px] font-mono uppercase tracking-widest text-neutral-600 block mb-1">Weekly Rate ({STUDIO.currency.code})</label>
                        <input
                          type="number"
                          value={item.weekly_rate}
                          onChange={(e) => updateItem(item._id, { weekly_rate: Number(e.target.value) || 0 })}
                          className="w-full bg-neutral-900 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-[#D4A843]/50"
                        />
                      </div>

                      {/* Deposit */}
                      <div>
                        <label className="text-[9px] font-mono uppercase tracking-widest text-neutral-600 block mb-1">Deposit ({STUDIO.currency.code})</label>
                        <input
                          type="number"
                          value={item.deposit}
                          onChange={(e) => updateItem(item._id, { deposit: Number(e.target.value) || 0 })}
                          className="w-full bg-neutral-900 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-[#D4A843]/50"
                        />
                      </div>
                    </div>

                    {/* Description */}
                    <div>
                      <label className="text-[9px] font-mono uppercase tracking-widest text-neutral-600 block mb-1">Description</label>
                      <textarea
                        value={item.description ?? ''}
                        onChange={(e) => updateItem(item._id, { description: e.target.value || null })}
                        rows={2}
                        className="w-full bg-neutral-900 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-[#D4A843]/50 resize-none"
                      />
                    </div>

                    {/* Features */}
                    <div>
                      <label className="text-[9px] font-mono uppercase tracking-widest text-neutral-600 block mb-1">Features (comma-separated)</label>
                      <input
                        type="text"
                        value={item.features.join(', ')}
                        onChange={(e) => updateItem(item._id, {
                          features: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                        })}
                        className="w-full bg-neutral-900 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-[#D4A843]/50"
                      />
                    </div>

                    {/* Tags */}
                    <div>
                      <label className="text-[9px] font-mono uppercase tracking-widest text-neutral-600 block mb-1">Tags (comma-separated)</label>
                      <input
                        type="text"
                        value={item.tags.join(', ')}
                        onChange={(e) => updateItem(item._id, {
                          tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                        })}
                        className="w-full bg-neutral-900 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-[#D4A843]/50"
                      />
                    </div>

                    {/* Gallery upload */}
                    <div>
                      <label className="text-[9px] font-mono uppercase tracking-widest text-neutral-600 block mb-2">Photos</label>
                      <div className="flex items-center gap-3 flex-wrap">
                        {item._gallery.map((asset, gi) => (
                          <div key={gi} className="relative w-16 h-16 bg-neutral-800 rounded overflow-hidden group">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={asset.url} alt="" className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={() => updateItem(item._id, {
                                _gallery: item._gallery.filter((_, idx) => idx !== gi),
                                _status: item._gallery.length <= 1 ? 'ready' : 'complete',
                              })}
                              className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/70 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="w-2.5 h-2.5 text-white" />
                            </button>
                          </div>
                        ))}
                        <label className="w-16 h-16 border border-dashed border-white/10 rounded flex items-center justify-center cursor-pointer hover:border-[#D4A843]/50 transition-colors">
                          <Upload className="w-4 h-4 text-neutral-600" />
                          <input
                            ref={(el) => { galInputRefs.current[item._id] = el; }}
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={(e) => handleGalleryUpload(item._id, e.target.files)}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
