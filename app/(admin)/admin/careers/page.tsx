'use client';

import { useState } from 'react';
import { Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { careers as initialCareers, type Career } from '@/lib/data';

type Form = Omit<Career, 'id' | 'createdAt'>;

const EMPTY: Form = {
  title: '',
  department: '',
  location: '',
  description: '',
  isPublished: false,
};

export default function AdminCareersPage() {
  const [items, setItems] = useState<Career[]>([...initialCareers]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY);
    setShowForm(true);
  };

  const openEdit = (item: Career) => {
    setEditingId(item.id);
    setForm({
      title: item.title,
      department: item.department,
      location: item.location,
      description: item.description,
      isPublished: item.isPublished,
    });
    setShowForm(true);
  };

  const cancel = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY);
  };

  const save = () => {
    if (!form.title.trim()) return;
    if (editingId) {
      setItems(prev =>
        prev.map(c => (c.id === editingId ? { ...c, ...form } : c))
      );
    } else {
      const newItem: Career = {
        ...form,
        id: Date.now().toString(),
        createdAt: new Date().toISOString().slice(0, 10),
      };
      setItems(prev => [...prev, newItem]);
    }
    cancel();
  };

  const remove = (id: string) =>
    setItems(prev => prev.filter(c => c.id !== id));

  const togglePublish = (id: string) =>
    setItems(prev =>
      prev.map(c => (c.id === id ? { ...c, isPublished: !c.isPublished } : c))
    );

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
          <label className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-400 cursor-pointer mb-6">
            <input
              type="checkbox"
              checked={form.isPublished}
              onChange={e => setForm(f => ({ ...f, isPublished: e.target.checked }))}
              className="accent-white"
            />
            Published
          </label>
          <div className="flex gap-3">
            <button
              onClick={save}
              className="px-5 py-2 bg-white text-black text-[10px] font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity"
            >
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
      {items.length === 0 ? (
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
                      item.isPublished ? 'bg-emerald-400' : 'bg-neutral-600'
                    }`}
                  />
                  <p className="text-sm font-mono text-white truncate">{item.title}</p>
                </div>
                <p className="text-[10px] font-mono text-neutral-600 pl-[18px]">
                  {item.department} · {item.location} · {item.createdAt}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <ActionBtn
                  onClick={() => togglePublish(item.id)}
                  title={item.isPublished ? 'Unpublish' : 'Publish'}
                >
                  {item.isPublished ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </ActionBtn>
                <ActionBtn onClick={() => openEdit(item)} title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </ActionBtn>
                <ActionBtn onClick={() => remove(item.id)} title="Delete" danger>
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
