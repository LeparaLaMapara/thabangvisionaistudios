'use client';

import { useState, useCallback, useRef } from 'react';
import Image from 'next/image';
import { Upload, Loader2, Plus, Trash2 } from 'lucide-react';
import { RENTAL_CATEGORIES, STUDIO } from '@/lib/constants';
import { LISTING_CONDITIONS, MIN_CONFIDENCE, normaliseCondition } from '@/lib/core/listings/suggest';
import type { GearIdentificationResult } from '@/lib/agents/types';

/**
 * Onboarding gear step: one photo per item, recognised by AI, edited by the
 * owner, saved as DRAFT listings (POST /api/onboarding/create-rentals).
 *
 * What the owner changes here (name, category, condition, day rate) is sent
 * as their own value; what they leave as the AI had it stays AI-suggested
 * and must be confirmed on the listings page before submitting. Nothing is
 * dropped silently: an item the AI was unsure about is still saved, flagged.
 */

interface GearItem {
  imageUrl: string;
  identification: GearIdentificationResult | null;
  name: string;
  category: string;
  condition: string;
  dailyRate: string;
  /** What the AI filled in, to tell an owner's edit from the AI's value. */
  ai: { name: string; category: string; condition: string } | null;
  uploading: boolean;
  analyzing: boolean;
  error: string | null;
}

export interface GearDraftResult {
  created: number;
  failed: number;
  lowConfidence: number;
}

interface StepGearRentalsProps {
  onComplete: (gear: GearItem[], result: GearDraftResult | null) => void;
  onSkip: () => void;
}

const FIELD_CLASS =
  'w-full min-h-[44px] bg-neutral-900 border border-white/10 text-white px-3 py-2 text-xs font-mono placeholder:text-neutral-400 focus:outline-none focus:border-[#D4A843] focus-visible:ring-2 focus-visible:ring-[#D4A843] transition-colors disabled:opacity-50';
const LABEL_CLASS = 'block text-xs font-bold uppercase tracking-widest text-neutral-400 mb-1';

function conditionLabel(c: string): string {
  return c.charAt(0).toUpperCase() + c.slice(1).replace('-', ' ');
}

/** Vision answers 0-100. */
function confidence01(id: GearIdentificationResult | null): number | null {
  if (!id) return null;
  const n = Number(id.confidence);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

export default function StepGearRentals({ onComplete, onSkip }: StepGearRentalsProps) {
  const [items, setItems] = useState<GearItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validItems = items.filter(i => i.imageUrl && !i.uploading && !i.analyzing && !i.error && i.name.trim() && i.category);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setError('Please upload a JPG or PNG image.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Image must be under 10MB.');
      return;
    }

    setError(null);

    const newItem: GearItem = {
      imageUrl: '',
      identification: null,
      name: '',
      category: '',
      condition: '',
      dailyRate: '',
      ai: null,
      uploading: true,
      analyzing: false,
      error: null,
    };

    const itemIndex = items.length;
    setItems(prev => [...prev, newItem]);

    try {
      // Upload to Cloudinary
      const signRes = await fetch('/api/cloudinary/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ paramsToSign: { folder: 'gear', resource_type: 'image' } }),
      });

      if (!signRes.ok) throw new Error('Failed to sign upload.');
      const { signature, timestamp, cloudName, apiKey } = await signRes.json();

      const formData = new FormData();
      formData.append('file', file);
      formData.append('signature', signature);
      formData.append('timestamp', timestamp);
      formData.append('api_key', apiKey);
      formData.append('folder', 'gear');

      const uploadRes = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
        { method: 'POST', body: formData },
      );
      const uploadData = await uploadRes.json();

      if (!uploadData.secure_url) throw new Error('Upload failed.');

      setItems(prev => {
        const updated = [...prev];
        updated[itemIndex] = { ...updated[itemIndex], imageUrl: uploadData.secure_url, uploading: false, analyzing: true };
        return updated;
      });

      const agentRes = await fetch('/api/agents/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'identify-gear', imageUrl: uploadData.secure_url }),
      });

      const agentData = await agentRes.json();

      if (agentRes.ok && agentData.data) {
        const result = agentData.data as GearIdentificationResult;
        const name = [result.brand, result.model].filter(Boolean).join(' ');
        const category = RENTAL_CATEGORIES.some(c => c.value === result.category) ? result.category : '';
        const condition = normaliseCondition(result.condition) ?? '';
        setItems(prev => {
          const updated = [...prev];
          updated[itemIndex] = {
            ...updated[itemIndex],
            identification: result,
            name,
            category,
            condition,
            ai: { name, category, condition },
            analyzing: false,
          };
          return updated;
        });
      } else {
        // AI failed: the owner fills it in.
        setItems(prev => {
          const updated = [...prev];
          updated[itemIndex] = { ...updated[itemIndex], analyzing: false };
          return updated;
        });
      }
    } catch (err) {
      setItems(prev => {
        const updated = [...prev];
        updated[itemIndex] = {
          ...updated[itemIndex],
          uploading: false,
          analyzing: false,
          error: err instanceof Error ? err.message : 'Failed to process gear photo.',
        };
        return updated;
      });
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [items.length]);

  const updateItem = useCallback((index: number, field: 'name' | 'category' | 'condition' | 'dailyRate', value: string) => {
    setItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  }, []);

  const removeItem = useCallback((index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  }, []);

  const [creatingDrafts, setCreatingDrafts] = useState(false);

  const handleListAll = async () => {
    if (validItems.length === 0) {
      setError('Give each item a name and a category.');
      return;
    }

    // Every item with a name is sent, recognised or not, with what the owner
    // changed marked as theirs.
    const payload = validItems.map((i) => {
      const id = i.identification;
      return {
        brand: id?.brand ?? null,
        model: id?.model ?? null,
        equipmentType: id?.equipmentType ?? null,
        confidence: confidence01(id),
        thumbnailUrl: i.imageUrl,
        title: i.name.trim(),
        category: i.category || null,
        condition: i.condition || null,
        dailyRate: i.dailyRate.trim() || null,
        ownerEdited: {
          title: !i.ai || i.name.trim() !== i.ai.name,
          category: !i.ai || i.category !== i.ai.category,
          condition: !i.ai || i.condition !== i.ai.condition,
        },
      };
    });

    setCreatingDrafts(true);
    setError(null);
    let result: GearDraftResult;
    try {
      const res = await fetch('/api/onboarding/create-rentals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ items: payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to draft listings.');
      }
      result = {
        created: Array.isArray(data.created) ? data.created.length : 0,
        failed: Array.isArray(data.failed) ? data.failed.length : 0,
        lowConfidence: typeof data.lowConfidence === 'number' ? data.lowConfidence : 0,
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to draft listings.');
      setCreatingDrafts(false);
      return;
    }
    setCreatingDrafts(false);
    onComplete(validItems, result);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-white mb-1">
          List Your Gear
        </h2>
        <p className="text-xs font-mono text-neutral-400 leading-relaxed">
          Add a photo of each item you&apos;d like to rent out. We suggest the details; you check them. Each item is
          saved as a draft listing, and nothing goes live until you submit it.
        </p>
      </div>

      {items.map((item, index) => {
        const conf = confidence01(item.identification);
        const unsure = conf !== null && conf < MIN_CONFIDENCE;
        const busy = item.uploading || item.analyzing;
        return (
          <div key={index} className="border border-white/10 p-4 space-y-4">
            <div className="flex gap-4">
              <div className="w-24 h-24 bg-neutral-900 border border-white/5 flex-shrink-0 relative overflow-hidden">
                {busy ? (
                  <div className="w-full h-full flex items-center justify-center" role="status" aria-label="Processing photo">
                    <Loader2 className="w-5 h-5 text-[#D4A843] animate-spin" aria-hidden="true" />
                  </div>
                ) : item.imageUrl ? (
                  <Image src={item.imageUrl} alt={item.name || 'Gear photo'} fill sizes="96px" className="object-cover" />
                ) : null}
              </div>

              <div className="flex-1 space-y-3 min-w-0">
                <div>
                  <label htmlFor={`gear-${index}-name`} className={LABEL_CLASS}>
                    Name <span className="text-red-400" aria-hidden="true">*</span>
                  </label>
                  <input
                    id={`gear-${index}-name`}
                    type="text"
                    required
                    aria-required="true"
                    value={item.name}
                    onChange={(e) => updateItem(index, 'name', e.target.value)}
                    placeholder="e.g. Sony A7 III"
                    disabled={busy}
                    className={FIELD_CLASS}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label htmlFor={`gear-${index}-category`} className={LABEL_CLASS}>
                      Category <span className="text-red-400" aria-hidden="true">*</span>
                    </label>
                    <select
                      id={`gear-${index}-category`}
                      required
                      aria-required="true"
                      value={item.category}
                      onChange={(e) => updateItem(index, 'category', e.target.value)}
                      disabled={busy}
                      className={FIELD_CLASS}
                    >
                      <option value="">Choose</option>
                      {RENTAL_CATEGORIES.map(cat => (
                        <option key={cat.value} value={cat.value}>{cat.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor={`gear-${index}-condition`} className={LABEL_CLASS}>
                      Condition
                    </label>
                    <select
                      id={`gear-${index}-condition`}
                      value={item.condition}
                      onChange={(e) => updateItem(index, 'condition', e.target.value)}
                      disabled={busy}
                      className={FIELD_CLASS}
                    >
                      <option value="">Choose</option>
                      {LISTING_CONDITIONS.map((c) => (
                        <option key={c} value={c}>{conditionLabel(c)}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor={`gear-${index}-rate`} className={LABEL_CLASS}>
                    Day rate ({STUDIO.currency.code}, optional)
                  </label>
                  <input
                    id={`gear-${index}-rate`}
                    type="number"
                    inputMode="numeric"
                    value={item.dailyRate}
                    onChange={(e) => updateItem(index, 'dailyRate', e.target.value)}
                    placeholder="Leave blank for a suggested rate"
                    min="1"
                    disabled={busy}
                    className={FIELD_CLASS}
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => removeItem(index)}
                aria-label={`Remove ${item.name || 'this item'}`}
                className="self-start min-w-[44px] min-h-[44px] flex items-center justify-center text-neutral-400 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {item.error && (
              <p className="text-xs font-mono text-red-400" role="alert">{item.error}</p>
            )}

            {item.identification && !busy && (
              <p className={`text-xs font-mono ${unsure ? 'text-amber-300' : 'text-neutral-400'}`}>
                {unsure
                  ? 'We are not sure what this is. Check the name and category; it is saved as a draft for you to finish.'
                  : `Recognised as ${item.identification.equipmentType || 'gear'}. You check every detail before it goes live.`}
              </p>
            )}
            {!item.identification && !busy && item.imageUrl && !item.error && (
              <p className="text-xs font-mono text-neutral-400">We could not recognise this photo. Type its name.</p>
            )}
          </div>
        );
      })}

      <label
        htmlFor="gear-photo-input"
        className="cursor-pointer block focus-within:ring-2 focus-within:ring-[#D4A843]"
      >
        <div className="border border-dashed border-white/10 hover:border-[#D4A843]/30 transition-colors p-6 min-h-[44px] flex items-center justify-center gap-2">
          <Plus className="w-4 h-4 text-neutral-400" aria-hidden="true" />
          <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">
            Add Gear Photo
          </span>
        </div>
        <input
          id="gear-photo-input"
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          onChange={handleFileSelect}
          className="sr-only"
        />
      </label>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onSkip}
          className="flex-1 border border-white/10 text-neutral-400 py-3 px-6 text-xs font-mono uppercase tracking-widest hover:text-white hover:border-white/20 transition-colors min-h-[44px]"
        >
          Skip for Now
        </button>

        {validItems.length > 0 && (
          <button
            type="button"
            onClick={handleListAll}
            disabled={creatingDrafts}
            className="flex-1 bg-[#D4A843] text-black py-3 px-6 text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity min-h-[44px] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {creatingDrafts ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                Saving drafts...
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                Save {validItems.length} as draft{validItems.length === 1 ? '' : 's'}
              </>
            )}
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 px-4 py-3" role="alert">
          <p className="text-xs text-red-400 font-mono">{error}</p>
        </div>
      )}
    </div>
  );
}
