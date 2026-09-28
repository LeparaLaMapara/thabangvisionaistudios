'use client';

import { useState, useTransition } from 'react';
import { Eye, EyeOff, Pencil, Trash2, X } from 'lucide-react';
import type { Faq } from './page';
import { togglePublish, updateFaq, deleteFaq } from './actions';

// ─── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = ['booking', 'pricing', 'equipment', 'creators', 'platform', 'general'] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_COLORS: Record<Category, string> = {
  booking: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  pricing: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  equipment: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  creators: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  platform: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  general: 'bg-neutral-500/20 text-neutral-300 border-neutral-500/30',
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-ZA', {
      timeZone: 'Africa/Johannesburg',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '...';
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function FaqsAdmin({ faqs }: { faqs: Faq[] }) {
  const [pending, startTransition] = useTransition();
  const [localFaqs, setLocalFaqs] = useState(faqs);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<Category | 'all'>('all');
  const [editingFaq, setEditingFaq] = useState<Faq | null>(null);
  const [editForm, setEditForm] = useState({ question: '', answer: '', category: 'general' });

  // ─── Derived state ──────────────────────────────────────────────────────────

  const publishedCount = localFaqs.filter((f) => f.is_published).length;
  const draftCount = localFaqs.filter((f) => !f.is_published).length;

  const filtered =
    activeCategory === 'all'
      ? localFaqs
      : localFaqs.filter((f) => f.category === activeCategory);

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const onTogglePublish = (faq: Faq) => {
    const next = !faq.is_published;
    setError(null);
    setLocalFaqs((prev) =>
      prev.map((f) => (f.id === faq.id ? { ...f, is_published: next } : f)),
    );
    startTransition(async () => {
      const result = await togglePublish(faq.id, next);
      if (!result.ok) {
        setError(result.error);
        setLocalFaqs((prev) =>
          prev.map((f) => (f.id === faq.id ? { ...f, is_published: !next } : f)),
        );
      }
    });
  };

  const openEdit = (faq: Faq) => {
    setEditingFaq(faq);
    setEditForm({
      question: faq.question,
      answer: faq.answer,
      category: faq.category,
    });
  };

  const closeEdit = () => {
    setEditingFaq(null);
    setEditForm({ question: '', answer: '', category: 'general' });
  };

  const onSaveEdit = () => {
    if (!editingFaq) return;
    if (!editForm.question.trim() || !editForm.answer.trim()) return;

    const faqId = editingFaq.id;
    const updatedData = { ...editForm };

    setLocalFaqs((prev) =>
      prev.map((f) =>
        f.id === faqId
          ? { ...f, question: updatedData.question, answer: updatedData.answer, category: updatedData.category }
          : f,
      ),
    );
    closeEdit();
    setError(null);

    startTransition(async () => {
      const result = await updateFaq(faqId, updatedData);
      if (!result.ok) {
        setError(result.error);
      }
    });
  };

  const onDelete = (faq: Faq) => {
    const ok = confirm(`Delete FAQ: "${truncate(faq.question, 60)}"?\n\nThis cannot be undone.`);
    if (!ok) return;

    setError(null);
    setLocalFaqs((prev) => prev.filter((f) => f.id !== faq.id));

    startTransition(async () => {
      const result = await deleteFaq(faq.id);
      if (!result.ok) {
        setError(result.error);
        // Restore on failure
        setLocalFaqs((prev) => [...prev, faq].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ));
      }
    });
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Stats */}
      <div className="flex items-center gap-6 mb-6">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#D4A843]" />
          <span className="text-xs font-mono text-neutral-400">
            {publishedCount} published
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-neutral-600" />
          <span className="text-xs font-mono text-neutral-400">
            {draftCount} drafts
          </span>
        </div>
      </div>

      {/* Category filter tabs */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <button
          onClick={() => setActiveCategory('all')}
          className={`px-3 py-1.5 text-xs font-mono uppercase tracking-widest border transition-colors min-h-[44px] ${
            activeCategory === 'all'
              ? 'border-[#D4A843] text-[#D4A843] bg-[#D4A843]/10'
              : 'border-white/10 text-neutral-400 hover:border-white/30 hover:text-white'
          }`}
        >
          All ({localFaqs.length})
        </button>
        {CATEGORIES.map((cat) => {
          const count = localFaqs.filter((f) => f.category === cat).length;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 text-xs font-mono uppercase tracking-widest border transition-colors min-h-[44px] ${
                activeCategory === cat
                  ? 'border-[#D4A843] text-[#D4A843] bg-[#D4A843]/10'
                  : 'border-white/10 text-neutral-400 hover:border-white/30 hover:text-white'
              }`}
            >
              {cat} ({count})
            </button>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 border border-red-500/30 bg-red-500/10 text-red-300 text-sm font-mono">
          {error}
        </div>
      )}

      {/* Edit Modal */}
      {editingFaq && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-white/10 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <h2 className="text-xs font-mono uppercase tracking-widest text-white">
                Edit FAQ
              </h2>
              <button
                onClick={closeEdit}
                className="p-2 border border-white/10 text-neutral-400 hover:border-white/30 hover:text-white transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">
                  Question
                </label>
                <textarea
                  value={editForm.question}
                  onChange={(e) => setEditForm((f) => ({ ...f, question: e.target.value }))}
                  rows={2}
                  className="w-full bg-neutral-950 border border-white/10 text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-white/30 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">
                  Answer
                </label>
                <textarea
                  value={editForm.answer}
                  onChange={(e) => setEditForm((f) => ({ ...f, answer: e.target.value }))}
                  rows={5}
                  className="w-full bg-neutral-950 border border-white/10 text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-white/30 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">
                  Category
                </label>
                <select
                  value={editForm.category}
                  onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                  className="w-full bg-neutral-950 border border-white/10 text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-white/30"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={onSaveEdit}
                  disabled={pending || !editForm.question.trim() || !editForm.answer.trim()}
                  className="flex items-center gap-2 px-5 py-2 bg-[#D4A843] text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity disabled:opacity-50 min-h-[44px]"
                >
                  Save
                </button>
                <button
                  onClick={closeEdit}
                  className="px-5 py-2 border border-white/20 text-xs font-mono uppercase tracking-widest text-neutral-400 hover:text-white hover:border-white/40 transition-colors min-h-[44px]"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="border border-white/10 divide-y divide-white/10">
        {/* Header row */}
        <div className="hidden md:grid md:grid-cols-[1fr_1fr_auto_auto_auto_auto] gap-4 px-4 py-3 bg-white/[0.02]">
          <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">Question</span>
          <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">Answer</span>
          <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">Category</span>
          <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">Views</span>
          <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">Created</span>
          <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">Actions</span>
        </div>

        {filtered.map((faq) => (
          <div
            key={faq.id}
            className="flex flex-col md:grid md:grid-cols-[1fr_1fr_auto_auto_auto_auto] gap-3 md:gap-4 p-4 hover:bg-white/[0.02] transition-colors"
          >
            {/* Question */}
            <div className="min-w-0">
              <div className="flex items-start gap-2">
                <span
                  className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    faq.is_published ? 'bg-[#D4A843]' : 'bg-neutral-600'
                  }`}
                />
                <p className="text-sm font-mono text-white leading-snug">
                  {truncate(faq.question, 80)}
                </p>
              </div>
              {faq.source_conversation_id && (
                <p className="mt-1 ml-3.5 text-xs font-mono text-neutral-400">
                  from chat
                </p>
              )}
            </div>

            {/* Answer */}
            <div className="min-w-0">
              <p className="text-xs text-neutral-400 leading-relaxed">
                {truncate(faq.answer, 100)}
              </p>
            </div>

            {/* Category badge */}
            <div className="flex items-start md:items-center">
              <span
                className={`inline-block px-2 py-0.5 text-xs font-mono uppercase tracking-widest border ${
                  CATEGORY_COLORS[faq.category as Category] ?? CATEGORY_COLORS.general
                }`}
              >
                {faq.category}
              </span>
            </div>

            {/* View count */}
            <div className="flex items-center">
              <span className="text-xs font-mono text-neutral-400">
                {faq.view_count}
              </span>
            </div>

            {/* Created date */}
            <div className="flex items-center">
              <span className="text-xs font-mono text-neutral-400 whitespace-nowrap">
                {formatDate(faq.created_at)}
              </span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => onTogglePublish(faq)}
                disabled={pending}
                title={faq.is_published ? 'Unpublish' : 'Publish'}
                className={`p-2 border transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-50 ${
                  faq.is_published
                    ? 'border-[#D4A843]/40 text-[#D4A843] hover:border-[#D4A843] hover:text-[#D4A843]'
                    : 'border-white/10 text-neutral-400 hover:border-white/30 hover:text-white'
                }`}
              >
                {faq.is_published ? (
                  <Eye className="w-3.5 h-3.5" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => openEdit(faq)}
                disabled={pending}
                title="Edit"
                className="p-2 border border-white/10 text-neutral-400 hover:border-white/30 hover:text-white transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-50"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onDelete(faq)}
                disabled={pending}
                title="Delete"
                className="p-2 border border-red-900/40 text-red-600 hover:border-red-500/40 hover:text-red-400 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-neutral-400 font-mono text-center py-12">
          {activeCategory === 'all'
            ? 'No FAQs yet. Draft entries are auto-generated from chat conversations weekly.'
            : `No FAQs in the "${activeCategory}" category.`}
        </p>
      )}
    </div>
  );
}
