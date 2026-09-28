'use client';

import { useState } from 'react';
import { Loader2, Copy, Check, Sparkles } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

type Article = {
  id: string;
  slug: string;
  title: string;
  published_at: string | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return 'No date';
  try {
    return new Date(iso).toLocaleDateString('en-ZA', {
      timeZone: 'Africa/Johannesburg',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ContentRepurposeAdmin({ articles }: { articles: Article[] }) {
  const [selectedSlug, setSelectedSlug] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [articleTitle, setArticleTitle] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (!selectedSlug) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setArticleTitle(null);
    setCopied(false);

    try {
      const res = await fetch('/api/admin/content-repurpose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: selectedSlug }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Failed to generate content');
      }

      const data = await res.json();
      setResult(data.content);
      setArticleTitle(data.article);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Failed to copy to clipboard');
    }
  };

  // ─── Empty state ──────────────────────────────────────────────────────────

  if (articles.length === 0) {
    return (
      <p className="text-sm text-neutral-400 font-mono">
        No press articles found. Create articles in the Press admin first.
      </p>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Error banner */}
      {error && (
        <div className="mb-6 px-4 py-3 border border-red-500/30 bg-red-500/10 text-red-300 text-sm font-mono">
          {error}
        </div>
      )}

      {/* Article selector + generate button */}
      <div className="border border-white/10 p-6 mb-6">
        <label
          htmlFor="article-select"
          className="block text-xs font-mono uppercase tracking-widest text-neutral-400 mb-3"
        >
          Select Article
        </label>
        <select
          id="article-select"
          value={selectedSlug}
          onChange={(e) => setSelectedSlug(e.target.value)}
          disabled={loading}
          className="w-full bg-neutral-950 border border-white/10 text-white text-sm font-mono px-3 py-3 focus:outline-none focus:border-white/30 appearance-none cursor-pointer disabled:opacity-50 min-h-[44px]"
        >
          <option value="">Choose an article...</option>
          {articles.map((article) => (
            <option key={article.id} value={article.slug}>
              {article.title} — {formatDate(article.published_at)}
            </option>
          ))}
        </select>

        <button
          onClick={generate}
          disabled={!selectedSlug || loading}
          className="mt-4 flex items-center gap-2 px-5 py-3 bg-[#D4A843] text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity disabled:opacity-50 min-h-[44px]"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          {loading ? 'Generating...' : 'Generate Content'}
        </button>
      </div>

      {/* Loading indicator */}
      {loading && (
        <div className="border border-white/10 p-8 flex items-center justify-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-[#D4A843]" />
          <span className="text-sm font-mono text-neutral-400">
            AI is generating repurposed content. This may take a moment...
          </span>
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div className="border border-white/10">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/[0.02]">
            <div className="min-w-0">
              <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                Generated Content
              </p>
              {articleTitle && (
                <p className="text-xs font-mono text-neutral-400 mt-1 truncate">
                  {articleTitle}
                </p>
              )}
            </div>
            <button
              onClick={copyToClipboard}
              className="flex items-center gap-2 px-4 py-2 border border-white/10 text-xs font-mono uppercase tracking-widest text-neutral-400 hover:text-white hover:border-white/30 transition-colors min-h-[44px]"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy
                </>
              )}
            </button>
          </div>
          <pre className="p-6 text-sm font-mono text-neutral-300 whitespace-pre-wrap break-words overflow-x-auto max-h-[600px] overflow-y-auto">
            {result}
          </pre>
        </div>
      )}
    </div>
  );
}
