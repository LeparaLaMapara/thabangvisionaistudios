'use client';

import { useState, useCallback, useRef } from 'react';
import Image from 'next/image';
import { Upload, Loader2, Plus, Trash2 } from 'lucide-react';
import { RENTAL_CATEGORIES, STUDIO } from '@/lib/constants';
import type { GearIdentificationResult } from '@/lib/agents/types';

interface GearItem {
  imageUrl: string;
  identification: GearIdentificationResult | null;
  name: string;
  category: string;
  condition: string;
  dailyRate: string;
  uploading: boolean;
  analyzing: boolean;
  error: string | null;
}

interface StepGearRentalsProps {
  onComplete: (gear: GearItem[]) => void;
  onSkip: () => void;
}

export default function StepGearRentals({ onComplete, onSkip }: StepGearRentalsProps) {
  const [items, setItems] = useState<GearItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validItems = items.filter(i => i.imageUrl && !i.uploading && !i.analyzing && !i.error && i.name.trim());

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
      category: 'cameras-optics',
      condition: 'good',
      dailyRate: '',
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

      // Update item with URL, start analyzing
      setItems(prev => {
        const updated = [...prev];
        updated[itemIndex] = { ...updated[itemIndex], imageUrl: uploadData.secure_url, uploading: false, analyzing: true };
        return updated;
      });

      // Send to agent for identification
      const agentRes = await fetch('/api/agents/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'identify-gear', imageUrl: uploadData.secure_url }),
      });

      const agentData = await agentRes.json();

      if (agentRes.ok && agentData.data) {
        const result = agentData.data as GearIdentificationResult;
        setItems(prev => {
          const updated = [...prev];
          updated[itemIndex] = {
            ...updated[itemIndex],
            identification: result,
            name: `${result.brand} ${result.model}`,
            category: result.category,
            condition: result.condition,
            analyzing: false,
          };
          return updated;
        });
      } else {
        // AI failed, let user fill manually
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

  const updateItem = useCallback((index: number, field: keyof GearItem, value: string) => {
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
  const [draftResult, setDraftResult] = useState<{ created: number; failed: number } | null>(null);

  const handleListAll = async () => {
    if (validItems.length === 0) {
      setError('Add at least one gear item with a name.');
      return;
    }

    const aiIdentified = validItems
      .filter((i) => i.identification && i.identification.confidence >= 70)
      .map((i) => ({
        brand: i.identification!.brand,
        model: i.identification!.model,
        category: i.identification!.category,
        equipmentType: i.identification!.equipmentType,
        condition: i.condition,
        confidence: i.identification!.confidence / 100,
        thumbnailUrl: i.imageUrl,
      }));

    if (aiIdentified.length > 0) {
      setCreatingDrafts(true);
      setError(null);
      try {
        const res = await fetch('/api/onboarding/create-rentals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ items: aiIdentified }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to draft listings.');
        }
        setDraftResult({
          created: (data.created as unknown[])?.length ?? 0,
          failed: (data.failed as unknown[])?.length ?? 0,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to draft listings.');
        setCreatingDrafts(false);
        return;
      }
      setCreatingDrafts(false);
    }

    onComplete(validItems);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-white mb-1">
          List Your Gear
        </h2>
        <p className="text-[10px] font-mono text-neutral-400 leading-relaxed">
          Upload photos of equipment you&apos;d like to rent out. Our AI will identify each item automatically.
        </p>
      </div>

      {/* Gear items */}
      {items.map((item, index) => (
        <div key={index} className="border border-white/10 p-4 space-y-4">
          <div className="flex gap-4">
            {/* Image preview */}
            <div className="w-24 h-24 bg-neutral-900 border border-white/5 flex-shrink-0 relative overflow-hidden">
              {item.uploading || item.analyzing ? (
                <div className="w-full h-full flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-[#D4A843] animate-spin" />
                </div>
              ) : item.imageUrl ? (
                <Image src={item.imageUrl} alt="Gear" fill sizes="96px" className="object-cover" />
              ) : null}
            </div>

            {/* Fields */}
            <div className="flex-1 space-y-3">
              <div>
                <label className="block text-[8px] font-bold uppercase tracking-widest text-neutral-400 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={item.name}
                  onChange={(e) => updateItem(index, 'name', e.target.value)}
                  placeholder="e.g. Sony A7 III"
                  disabled={item.uploading || item.analyzing}
                  className="w-full bg-neutral-900 border border-white/10 text-white px-3 py-2 text-xs font-mono placeholder:text-neutral-400 focus:outline-none focus:border-[#D4A843] transition-colors disabled:opacity-50"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[8px] font-bold uppercase tracking-widest text-neutral-400 mb-1">
                    Category
                  </label>
                  <select
                    value={item.category}
                    onChange={(e) => updateItem(index, 'category', e.target.value)}
                    disabled={item.uploading || item.analyzing}
                    className="w-full bg-neutral-900 border border-white/10 text-white px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#D4A843] transition-colors disabled:opacity-50"
                  >
                    {RENTAL_CATEGORIES.map(cat => (
                      <option key={cat.value} value={cat.value}>{cat.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[8px] font-bold uppercase tracking-widest text-neutral-400 mb-1">
                    Condition
                  </label>
                  <select
                    value={item.condition}
                    onChange={(e) => updateItem(index, 'condition', e.target.value)}
                    disabled={item.uploading || item.analyzing}
                    className="w-full bg-neutral-900 border border-white/10 text-white px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#D4A843] transition-colors disabled:opacity-50"
                  >
                    <option value="new">New</option>
                    <option value="like_new">Like New</option>
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="for_parts">For Parts</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[8px] font-bold uppercase tracking-widest text-neutral-400 mb-1">
                  Daily Rate ({STUDIO.currency.code})
                </label>
                <input
                  type="number"
                  value={item.dailyRate}
                  onChange={(e) => updateItem(index, 'dailyRate', e.target.value)}
                  placeholder="e.g. 500"
                  min="0"
                  disabled={item.uploading || item.analyzing}
                  className="w-full bg-neutral-900 border border-white/10 text-white px-3 py-2 text-xs font-mono placeholder:text-neutral-400 focus:outline-none focus:border-[#D4A843] transition-colors disabled:opacity-50"
                />
              </div>
            </div>

            {/* Remove */}
            <button
              type="button"
              onClick={() => removeItem(index)}
              className="self-start p-2 text-neutral-400 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          {item.error && (
            <p className="text-[9px] font-mono text-red-400">{item.error}</p>
          )}

          {item.identification && item.identification.confidence > 0 && (
            <p className="text-[9px] font-mono text-neutral-400">
              AI confidence: {item.identification.confidence}% — {item.identification.equipmentType}
            </p>
          )}
        </div>
      ))}

      {/* Add gear button */}
      <label className="cursor-pointer block">
        <div className="border border-dashed border-white/10 hover:border-[#D4A843]/30 transition-colors p-6 flex items-center justify-center gap-2">
          <Plus className="w-4 h-4 text-neutral-400" />
          <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400">
            Add Gear Photo
          </span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          onChange={handleFileSelect}
          className="hidden"
        />
      </label>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onSkip}
          className="flex-1 border border-white/10 text-neutral-400 py-3 px-6 text-[10px] font-mono uppercase tracking-widest hover:text-white hover:border-white/20 transition-colors min-h-[44px]"
        >
          Skip for Now
        </button>

        {validItems.length > 0 && (
          <button
            type="button"
            onClick={handleListAll}
            disabled={creatingDrafts}
            className="flex-1 bg-[#D4A843] text-black py-3 px-6 text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity min-h-[44px] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {creatingDrafts ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Drafting listings...
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5" />
                List All ({validItems.length})
              </>
            )}
          </button>
        )}
      </div>

      {draftResult && (
        <div className="bg-[#D4A843]/5 border border-[#D4A843]/30 px-4 py-3">
          <p className="text-xs text-[#D4A843] font-mono">
            {draftResult.created} draft listing{draftResult.created === 1 ? '' : 's'} created.
            {draftResult.failed > 0 && ` ${draftResult.failed} failed.`}
            {' '}Review and publish from the Listings dashboard.
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 px-4 py-3">
          <p className="text-xs text-red-400 font-mono">{error}</p>
        </div>
      )}
    </div>
  );
}
