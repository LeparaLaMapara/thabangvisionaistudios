'use client';

import { useEffect, useState } from 'react';
import {
  ArrowDown, ArrowUp, Eye, EyeOff, Loader2, Pencil, Plus, Trash2, X,
} from 'lucide-react';
import type { ProductionCategoryRow } from '@/types/production';
import { useAdminUI } from '@/components/admin/shell/AdminUI';

// ─── Types ───────────────────────────────────────────────────────────────────

type Form = {
  slug: string;
  name: string;
  description: string;
  sub_types: string;
  starting_rate: string;
  starting_unit: string;
  project_type: string;
  creator_keywords: string;
  cover_image_url: string;
  icon: string;
  is_published: boolean;
};

const EMPTY: Form = {
  slug: '',
  name: '',
  description: '',
  sub_types: '',
  starting_rate: '0',
  starting_unit: 'session',
  project_type: '',
  creator_keywords: '',
  cover_image_url: '',
  icon: '',
  is_published: true,
};

const UNITS = ['session', 'project', 'package', 'event'];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AdminProductionCategoriesPage() {
  const ui = useAdminUI();
  const [items, setItems] = useState<ProductionCategoryRow[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Fetch ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchCategories();
  }, []);

  async function fetchCategories() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/production-categories');
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to fetch');
      }
      const data = await res.json();
      setItems((data as ProductionCategoryRow[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch categories');
    }
    setLoading(false);
  }

  // ─── Form helpers ──────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY);
    setShowForm(true);
  };

  const openEdit = (item: ProductionCategoryRow) => {
    setEditingId(item.id);
    setForm({
      slug: item.slug,
      name: item.name,
      description: item.description ?? '',
      sub_types: (item.sub_types ?? []).join(', '),
      starting_rate: String(item.starting_rate),
      starting_unit: item.starting_unit,
      project_type: item.project_type,
      creator_keywords: (item.creator_keywords ?? []).join(', '),
      cover_image_url: item.cover_image_url ?? '',
      icon: item.icon ?? '',
      is_published: item.is_published,
    });
    setShowForm(true);
  };

  const close = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY);
    setError(null);
  };

  // ─── Save (create or update) ────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    setError(null);

    const payload: Record<string, unknown> = {
      slug: form.slug.trim(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      sub_types: form.sub_types.split(',').map(s => s.trim()).filter(Boolean),
      starting_rate: parseInt(form.starting_rate, 10) || 0,
      starting_unit: form.starting_unit,
      project_type: form.project_type.trim(),
      creator_keywords: form.creator_keywords.split(',').map(s => s.trim()).filter(Boolean),
      cover_image_url: form.cover_image_url.trim() || null,
      icon: form.icon.trim() || null,
      is_published: form.is_published,
    };

    try {
      if (editingId) {
        // Update
        const res = await fetch('/api/admin/production-categories', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingId, ...payload }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to update');
        }
      } else {
        // Create
        const res = await fetch('/api/admin/production-categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to create');
        }
      }

      close();
      await fetchCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
    setSaving(false);
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete(id: string) {
    const cat = items.find((c) => c.id === id);
    const ok = await ui.confirm({
      title: `Delete ${cat ? `“${cat.name}”` : 'this production type'}?`,
      body: 'It disappears from the site. Productions that use it must be moved to another type first.',
      action: 'Delete it',
      danger: true,
    });
    if (!ok) return;

    try {
      const res = await fetch(`/api/admin/production-categories?id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete');
      }
      await fetchCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  // ─── Toggle publish ────────────────────────────────────────────────────────

  async function togglePublish(item: ProductionCategoryRow) {
    try {
      const res = await fetch('/api/admin/production-categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, is_published: !item.is_published }),
      });
      if (!res.ok) throw new Error('Failed to toggle');
      await fetchCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toggle failed');
    }
  }

  // ─── Reorder ────────────────────────────────────────────────────────────────

  async function moveCategory(index: number, direction: 'up' | 'down') {
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= items.length) return;

    const a = items[index];
    const b = items[swapIndex];

    try {
      await Promise.all([
        fetch('/api/admin/production-categories', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: a.id, display_order: b.display_order }),
        }),
        fetch('/api/admin/production-categories', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: b.id, display_order: a.display_order }),
        }),
      ]);
      await fetchCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reorder failed');
    }
  }

  // ─── Auto-slug from name ────────────────────────────────────────────────────

  function handleNameChange(name: string) {
    setForm(prev => ({
      ...prev,
      name,
      slug: editingId
        ? prev.slug
        : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    }));
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-white">Production Categories</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Manage service categories shown on the Smart Productions page.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-[#D4A843] text-black px-4 py-2 rounded text-sm font-medium hover:bg-[#c49a3a] transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Category
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-[#D4A843] animate-spin" />
        </div>
      )}

      {/* Table */}
      {!loading && items.length > 0 && (
        <div className="border border-white/10 rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="text-left px-4 py-3 text-xs font-mono text-neutral-400 uppercase">#</th>
                <th className="text-left px-4 py-3 text-xs font-mono text-neutral-400 uppercase">Name</th>
                <th className="text-left px-4 py-3 text-xs font-mono text-neutral-400 uppercase hidden md:table-cell">Slug</th>
                <th className="text-left px-4 py-3 text-xs font-mono text-neutral-400 uppercase hidden lg:table-cell">Rate</th>
                <th className="text-left px-4 py-3 text-xs font-mono text-neutral-400 uppercase">Status</th>
                <th className="text-right px-4 py-3 text-xs font-mono text-neutral-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => moveCategory(i, 'up')}
                        disabled={i === 0}
                        className="p-0.5 text-neutral-400 hover:text-white disabled:opacity-20"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => moveCategory(i, 'down')}
                        disabled={i === items.length - 1}
                        className="p-0.5 text-neutral-400 hover:text-white disabled:opacity-20"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                      <span className="text-neutral-400 font-mono ml-1">{item.display_order}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-white">{item.name}</p>
                    <p className="text-xs text-neutral-400">{(item.sub_types ?? []).join(', ')}</p>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <code className="text-xs text-neutral-400 bg-white/5 px-2 py-0.5 rounded">{item.slug}</code>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <span className="text-[#D4A843] font-mono text-xs">
                      R{item.starting_rate.toLocaleString('en-ZA')}/{item.starting_unit}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => togglePublish(item)}
                      className={`flex items-center gap-1 text-xs font-mono uppercase ${
                        item.is_published ? 'text-emerald-400' : 'text-neutral-400'
                      }`}
                    >
                      {item.is_published ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      {item.is_published ? 'Live' : 'Draft'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEdit(item)} className="p-1.5 text-neutral-400 hover:text-white">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(item.id)} className="p-1.5 text-neutral-400 hover:text-red-400">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="py-12 text-center border border-white/10 rounded">
          <p className="text-neutral-400 text-sm">No categories yet. Run migration 025 and seed data.</p>
        </div>
      )}

      {/* ── Form Modal ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#0A0A0B] border border-white/10 rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h2 className="text-lg font-display font-bold text-white">
                {editingId ? 'Edit Category' : 'New Category'}
              </h2>
              <button onClick={close} className="p-1 text-neutral-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-mono text-neutral-400 uppercase mb-1">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white focus:border-[#D4A843]/50 focus:outline-none"
                  placeholder="Photography"
                />
              </div>

              {/* Slug */}
              <div>
                <label className="block text-xs font-mono text-neutral-400 uppercase mb-1">Slug</label>
                <input
                  value={form.slug}
                  onChange={(e) => setForm(f => ({ ...f, slug: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white focus:border-[#D4A843]/50 focus:outline-none"
                  placeholder="photography"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-mono text-neutral-400 uppercase mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white focus:border-[#D4A843]/50 focus:outline-none resize-none"
                />
              </div>

              {/* Sub-types */}
              <div>
                <label className="block text-xs font-mono text-neutral-400 uppercase mb-1">Sub-types (comma-separated)</label>
                <input
                  value={form.sub_types}
                  onChange={(e) => setForm(f => ({ ...f, sub_types: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white focus:border-[#D4A843]/50 focus:outline-none"
                  placeholder="Portrait & Headshot, Product & Commercial"
                />
              </div>

              {/* Rate + Unit */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono text-neutral-400 uppercase mb-1">Starting Rate (ZAR)</label>
                  <input
                    type="number"
                    value={form.starting_rate}
                    onChange={(e) => setForm(f => ({ ...f, starting_rate: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white focus:border-[#D4A843]/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-mono text-neutral-400 uppercase mb-1">Unit</label>
                  <select
                    value={form.starting_unit}
                    onChange={(e) => setForm(f => ({ ...f, starting_unit: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white focus:border-[#D4A843]/50 focus:outline-none"
                  >
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              {/* Project Type */}
              <div>
                <label className="block text-xs font-mono text-neutral-400 uppercase mb-1">Project Type (DB filter key)</label>
                <input
                  value={form.project_type}
                  onChange={(e) => setForm(f => ({ ...f, project_type: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white focus:border-[#D4A843]/50 focus:outline-none"
                  placeholder="photography"
                />
              </div>

              {/* Creator Keywords */}
              <div>
                <label className="block text-xs font-mono text-neutral-400 uppercase mb-1">Creator Keywords (comma-separated)</label>
                <input
                  value={form.creator_keywords}
                  onChange={(e) => setForm(f => ({ ...f, creator_keywords: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white focus:border-[#D4A843]/50 focus:outline-none"
                  placeholder="Photography, Portrait, Product Photography"
                />
              </div>

              {/* Cover Image URL */}
              <div>
                <label className="block text-xs font-mono text-neutral-400 uppercase mb-1">Cover Image URL (optional)</label>
                <input
                  value={form.cover_image_url}
                  onChange={(e) => setForm(f => ({ ...f, cover_image_url: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white focus:border-[#D4A843]/50 focus:outline-none"
                  placeholder="https://res.cloudinary.com/..."
                />
              </div>

              {/* Published */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_published}
                  onChange={(e) => setForm(f => ({ ...f, is_published: e.target.checked }))}
                  className="rounded border-white/20 bg-white/5 text-[#D4A843]"
                />
                <span className="text-sm text-neutral-300">Published</span>
              </label>

              {/* Error */}
              {error && (
                <p className="text-red-400 text-sm">{error}</p>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10">
              <button onClick={close} className="px-4 py-2 text-sm text-neutral-400 hover:text-white">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim() || !form.slug.trim() || !form.project_type.trim()}
                className="flex items-center gap-2 bg-[#D4A843] text-black px-4 py-2 rounded text-sm font-medium hover:bg-[#c49a3a] disabled:opacity-50 transition-colors"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
