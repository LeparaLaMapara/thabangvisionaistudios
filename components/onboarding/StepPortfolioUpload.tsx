'use client';

import { useState, useCallback, useRef } from 'react';
import Image from 'next/image';
import { Upload, X, Loader2, ImageIcon } from 'lucide-react';
import type { SceneAnalysisResult } from '@/lib/agents/types';

const SCENE_OPTIONS = [
  'wedding',
  'portrait',
  'corporate',
  'product',
  'event',
  'landscape',
  'fashion',
  'food',
  'real_estate',
  'other',
] as const;

interface PortfolioItem {
  url: string;
  analysis: SceneAnalysisResult | null;
  uploading: boolean;
  analyzing: boolean;
  error: string | null;
}

interface StepPortfolioUploadProps {
  onComplete: (analyses: SceneAnalysisResult[]) => void;
}

export default function StepPortfolioUpload({ onComplete }: StepPortfolioUploadProps) {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validAnalyses = items
    .map(i => i.analysis)
    .filter((a): a is SceneAnalysisResult => a !== null && a.qualityScore > 0);

  const canProceed = validAnalyses.length >= 5;

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setError(null);

    // Validate files
    const validFiles = files.filter(f => {
      if (!['image/jpeg', 'image/png'].includes(f.type)) return false;
      if (f.size > 10 * 1024 * 1024) return false;
      return true;
    });

    if (validFiles.length < files.length) {
      setError(`${files.length - validFiles.length} file(s) skipped (must be JPG/PNG under 10MB).`);
    }

    // Create placeholder items
    const newItems: PortfolioItem[] = validFiles.map(() => ({
      url: '',
      analysis: null,
      uploading: true,
      analyzing: false,
      error: null,
    }));

    setItems(prev => [...prev, ...newItems]);
    const startIndex = items.length;

    // Upload each file to Cloudinary
    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      const itemIndex = startIndex + i;

      try {
        const signRes = await fetch('/api/cloudinary/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ paramsToSign: { folder: 'portfolios', resource_type: 'image' } }),
        });

        if (!signRes.ok) throw new Error('Failed to sign upload.');
        const { signature, timestamp, cloudName, apiKey } = await signRes.json();

        const formData = new FormData();
        formData.append('file', file);
        formData.append('signature', signature);
        formData.append('timestamp', timestamp);
        formData.append('api_key', apiKey);
        formData.append('folder', 'portfolios');

        const uploadRes = await fetch(
          `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
          { method: 'POST', body: formData },
        );
        const uploadData = await uploadRes.json();

        if (!uploadData.secure_url) throw new Error('Upload failed.');

        setItems(prev => {
          const updated = [...prev];
          updated[itemIndex] = { ...updated[itemIndex], url: uploadData.secure_url, uploading: false };
          return updated;
        });
      } catch (err) {
        setItems(prev => {
          const updated = [...prev];
          updated[itemIndex] = {
            ...updated[itemIndex],
            uploading: false,
            error: err instanceof Error ? err.message : 'Upload failed',
          };
          return updated;
        });
      }
    }

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [items.length]);

  const removeItem = useCallback((index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleAnalyze = useCallback(async () => {
    const uploadedUrls = items
      .filter(i => i.url && !i.uploading && !i.error)
      .map(i => i.url);

    if (uploadedUrls.length < 5) {
      setError('Upload at least 5 photos before analyzing.');
      return;
    }

    setAnalyzing(true);
    setError(null);
    setAnalyzeProgress({ current: 0, total: uploadedUrls.length });

    try {
      const res = await fetch('/api/agents/portfolios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'analyze-portfolio', imageUrls: uploadedUrls }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed.');

      const analyses = data.data as SceneAnalysisResult[];

      // Map analyses back to items
      let analysisIdx = 0;
      setItems(prev =>
        prev.map(item => {
          if (item.url && !item.uploading && !item.error) {
            const analysis = analyses[analysisIdx] || null;
            analysisIdx++;
            return { ...item, analysis, analyzing: false };
          }
          return item;
        }),
      );

      setAnalyzeProgress({ current: uploadedUrls.length, total: uploadedUrls.length });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed. Try again.');
    } finally {
      setAnalyzing(false);
    }
  }, [items]);

  const correctTag = useCallback(async (index: number, newTag: string) => {
    const item = items[index];
    if (!item?.analysis || !item.url) return;
    const originalTag = item.analysis.sceneType;
    if (originalTag === newTag) return;

    setItems(prev => {
      const updated = [...prev];
      if (updated[index].analysis) {
        updated[index] = {
          ...updated[index],
          analysis: { ...updated[index].analysis!, sceneType: newTag },
        };
      }
      return updated;
    });

    try {
      await fetch('/api/agents/portfolios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'correct-tag',
          photoUrl: item.url,
          originalTag,
          correctedTag: newTag,
        }),
      });
    } catch (err) {
      console.warn('Tag correction failed silently:', err);
    }
  }, [items]);

  const handleProceed = () => {
    if (!canProceed) return;
    onComplete(validAnalyses);
  };

  const uploadedCount = items.filter(i => i.url && !i.uploading && !i.error).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-white mb-1">
          Portfolio Upload
        </h2>
        <p className="text-[10px] font-mono text-neutral-500 leading-relaxed">
          Upload at least 5 of your best photos. Our AI will analyze each one to detect your skills and specialties.
        </p>
      </div>

      {/* Upload area */}
      <label className="cursor-pointer block">
        <div className="border-2 border-dashed border-white/10 hover:border-[#D4A843]/30 transition-colors p-8 flex flex-col items-center gap-3">
          <Upload className="w-8 h-8 text-neutral-500" />
          <p className="text-xs font-mono text-neutral-400">
            Click to select photos or drag files here
          </p>
          <p className="text-[9px] font-mono text-neutral-600">
            JPG or PNG, up to 10MB each
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
      </label>

      {/* Photo count */}
      {items.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-mono text-neutral-400">
            {uploadedCount} photo{uploadedCount !== 1 ? 's' : ''} uploaded
            {uploadedCount < 5 && ` (need at least 5)`}
          </p>
          {analyzing && (
            <p className="text-[10px] font-mono text-[#D4A843]">
              Analyzing photo {analyzeProgress.current} of {analyzeProgress.total}...
            </p>
          )}
        </div>
      )}

      {/* Photo grid */}
      {items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {items.map((item, index) => (
            <div
              key={index}
              className="relative aspect-square bg-neutral-900 border border-white/5 overflow-hidden group"
            >
              {item.uploading ? (
                <div className="w-full h-full flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-neutral-500 animate-spin" />
                </div>
              ) : item.error ? (
                <div className="w-full h-full flex items-center justify-center p-2">
                  <p className="text-[8px] font-mono text-red-400 text-center">{item.error}</p>
                </div>
              ) : item.url ? (
                <>
                  <Image
                    src={item.url}
                    alt={`Portfolio photo ${index + 1}`}
                    fill
                    sizes="(max-width: 640px) 50vw, 33vw"
                    className="object-cover"
                  />
                  {/* Remove button */}
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    className="absolute top-1 right-1 w-6 h-6 bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                  {/* Analysis overlay (editable tag) */}
                  {item.analysis && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/80 px-2 py-1.5">
                      <select
                        value={item.analysis.sceneType}
                        onChange={(e) => correctTag(index, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full bg-transparent text-[8px] font-mono text-[#D4A843] uppercase cursor-pointer focus:outline-none"
                        aria-label="Scene type"
                      >
                        {SCENE_OPTIONS.map((opt) => (
                          <option key={opt} value={opt} className="bg-black text-[#D4A843]">
                            {opt}
                          </option>
                        ))}
                      </select>
                      <p className="text-[7px] font-mono text-neutral-400 truncate">
                        {item.analysis.description}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <ImageIcon className="w-5 h-5 text-neutral-700" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        {!analyzing && uploadedCount >= 5 && validAnalyses.length === 0 && (
          <button
            type="button"
            onClick={handleAnalyze}
            className="flex-1 bg-neutral-800 text-white py-3 px-6 text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-neutral-700 transition-colors min-h-[44px] flex items-center justify-center gap-2"
          >
            <ImageIcon className="w-3.5 h-3.5" />
            Analyze Photos
          </button>
        )}

        {canProceed && (
          <button
            type="button"
            onClick={handleProceed}
            className="flex-1 bg-[#D4A843] text-black py-3 px-6 text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity min-h-[44px]"
          >
            Looks Good
          </button>
        )}
      </div>

      {analyzing && (
        <div className="flex items-center justify-center gap-3 py-4">
          <Loader2 className="w-5 h-5 text-[#D4A843] animate-spin" />
          <p className="text-xs font-mono text-neutral-400">
            Analyzing your portfolio...
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
