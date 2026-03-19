'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Career } from '@/lib/supabase/queries/careers';

type EmploymentType = 'full-time' | 'part-time' | 'contract' | 'freelance';

type Form = {
  title: string;
  department: string;
  location: string;
  description: string;
  employment_type: EmploymentType | '';
  requirements: string;
  is_published: boolean;
};

const EMPTY: Form = {
  title: '',
  department: '',
  location: '',
  description: '',
  employment_type: '',
  requirements: '',
  is_published: false,
};

const EMPLOYMENT_TYPES: EmploymentType[] = ['full-time', 'part-time', 'contract', 'freelance'];

export default function AdminCareersPage() {
  const [items, setItems] = useState<Career[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Fetch ───────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchCareers();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchCareers() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/careers');
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to fetch');
      }
      const data = await res.json();
      setItems((data as Career[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch careers');
    }
    setLoading(false);
  }

  // ─── Form helpers ─────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY);
    setShowForm(true);
  };

  const openEdit = (item: Career) => {
    setEditingId(item.id);
    setForm({
      title: item.title,
      department: item.department ?? '',
      location: item.location ?? '',
      description: item.description ?? '',
      employment_type: item.employment_type ?? '',
      requirements: (item.requirements ?? []).join('\n'),
      is_published: item.is_published,
    });
    setShowForm(true);
  };

  const cancel = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY);
  };

  // ─── CRUD operations ──────────────────────────────────────────────────────

  const save = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    setError(null);

    const payload = {
      title: form.title.trim(),
      department: form.department.trim() || null,
      location: form.location.trim() || null,
      description: form.description.trim() || null,
      employment_type: (form.employment_type as EmploymentType) || null,
      requirements: form.requirements
        ? form.requirements.split('\n').map(r => r.trim()).filter(Boolean)
        : null,
      is_published: form.is_published,
    };

    try {
      if (editingId) {
        const res = await fetch('/api/admin/careers', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingId, ...payload }),
        });
        if (!res.ok) {
          const err = await res.json();
          setError(err.error || 'Failed to update');
        } else {
          const data = await res.json();
          setItems(prev =>
            prev.map(c => (c.id === editingId ? (data as Career) : c)),
          );
          cancel();
        }
      } else {
        const res = await fetch('/api/admin/careers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json();
          setError(err.error || 'Failed to create');
        } else {
          const data = await res.json();
          setItems(prev => [data as Career, ...prev]);
          cancel();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    }

    setSaving(false);
  };

  const softDelete = async (id: string) => {
    try {
      const res = await fetch('/api/admin/careers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, deleted_at: new Date().toISOString() }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || 'Failed to delete');
      } else {
        setItems(prev => prev.filter(c => c.id !== id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const togglePublish = async (item: Career) => {
    try {
      const res = await fetch('/api/admin/careers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, is_published: !item.is_published }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || 'Failed to update');
      } else {
        const data = await res.json();
        setItems(prev =>
          prev.map(c => (c.id === item.id ? (data as Career) : c)),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle publish');
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-10">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-600 mb-1">
            Admin
          </p>
          <h1 className="text-2xl font-display font-medium uppercase text-white">
            Careers
          </h1>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-white text-black text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity"
        >
          <Plus className="w-3 h-3" /> New Role
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 px-4 py-3 bg-red-950 border border-red-700/40 text-red-400 text-xs font-mono">
          {error}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="mb-10 bg-neutral-900 border border-white/10 p-6">
          <h2 className="text-xs font-mono uppercase tracking-widest text-white mb-6">
            {editingId ? 'Edit Role' : 'New Role'}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <Field
              label="Title"
              value={form.title}
              onChange={v => setForm(f => ({ ...f, title: v }))}
            />
            <Field
              label="Department"
              value={form.department}
              onChange={v => setForm(f => ({ ...f, department: v }))}
            />
            <Field
              label="Location"
              value={form.location}
              onChange={v => setForm(f => ({ ...f, location: v }))}
            />
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
                Employment Type
              </label>
              <select
                value={form.employment_type}
                onChange={e =>
                  setForm(f => ({
                    ...f,
                    employment_type: e.target.value as EmploymentType | '',
                  }))
                }
                className="w-full bg-neutral-950 border border-white/10 text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-white/30"
              >
                <option value="">— Select —</option>
                {EMPLOYMENT_TYPES.map(t => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
              Description
            </label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={3}
              className="w-full bg-neutral-950 border border-white/10 text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-white/30 resize-none"
            />
          </div>
          <div className="mb-4">
            <label className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">
              Requirements (one per line)
            </label>
            <textarea
              value={form.requirements}
              onChange={e => setForm(f => ({ ...f, requirements: e.target.value }))}
              rows={4}
              placeholder="3+ years experience&#10;Proficiency in X&#10;Strong communication skills"
              className="w-full bg-neutral-950 border border-white/10 text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-white/30 resize-none placeholder:text-neutral-700"
            />
          </div>
          <label className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-400 cursor-pointer mb-6">
            <input
              type="checkbox"
              checked={form.is_published}
              onChange={e => setForm(f => ({ ...f, is_published: e.target.checked }))}
              className="accent-white"
            />
            Published
          </label>
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
          No roles yet. Create one above.
        </p>
      ) : (
        <div className="space-y-px">
          {items.map(item => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-4 bg-neutral-900 border border-white/5 px-6 py-4 hover:border-white/10 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      item.is_published ? 'bg-emerald-400' : 'bg-neutral-600'
                    }`}
                  />
                  <p className="text-sm font-mono text-white truncate">{item.title}</p>
                </div>
                <p className="text-[10px] font-mono text-neutral-600 pl-[18px]">
                  {[item.department, item.location, item.employment_type]
                    .filter(Boolean)
                    .join(' · ')}
                  {item.created_at
                    ? ` · ${new Date(item.created_at).toLocaleDateString()}`
                    : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
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
