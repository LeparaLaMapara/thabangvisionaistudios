'use client';

import { useState } from 'react';
import { Loader2, Copy, Check, RotateCcw, Send } from 'lucide-react';

// ─── Constants ───────────────────────────────────────────────────────────────

const INDUSTRIES = [
  'Entertainment',
  'Corporate',
  'Advertising',
  'Real Estate',
  'Hospitality',
  'Education',
  'Government',
  'Non-profit',
  'Other',
] as const;

const SERVICES = [
  'Photography',
  'Video Production',
  'Live Streaming',
  'Drone',
  'Audio Production',
  'Post-Production',
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

type Form = {
  recipientName: string;
  recipientCompany: string;
  recipientRole: string;
  industry: string;
  servicesFit: string[];
  customContext: string;
};

const EMPTY: Form = {
  recipientName: '',
  recipientCompany: '',
  recipientRole: '',
  industry: '',
  servicesFit: [],
  customContext: '',
};

// ─── Component ───────────────────────────────────────────────────────────────

export function OutreachAdmin() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ emails: string; recipient: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // ─── Form helpers ──────────────────────────────────────────────────────────

  const canSubmit =
    form.recipientName.trim() &&
    form.recipientCompany.trim() &&
    form.recipientRole.trim() &&
    form.industry;

  const toggleService = (service: string) => {
    setForm((f) => ({
      ...f,
      servicesFit: f.servicesFit.includes(service)
        ? f.servicesFit.filter((s) => s !== service)
        : [...f.servicesFit, service],
    }));
  };

  const reset = () => {
    setForm(EMPTY);
    setResult(null);
    setError(null);
    setCopied(false);
  };

  // ─── Submit ────────────────────────────────────────────────────────────────

  const generate = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setCopied(false);

    try {
      const body: Record<string, unknown> = {
        recipientName: form.recipientName.trim(),
        recipientCompany: form.recipientCompany.trim(),
        recipientRole: form.recipientRole.trim(),
        industry: form.industry,
      };

      if (form.servicesFit.length > 0) {
        body.servicesFit = form.servicesFit;
      }

      if (form.customContext.trim()) {
        body.customContext = form.customContext.trim();
      }

      const res = await fetch('/api/admin/outreach-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Failed to generate outreach emails');
      }

      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Copy to clipboard ────────────────────────────────────────────────────

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Error */}
      {error && (
        <div className="mb-6 px-4 py-3 bg-red-950 border border-red-700/40 text-red-400 text-xs font-mono">
          {error}
        </div>
      )}

      {/* Form */}
      <div className="mb-10 bg-neutral-900 border border-white/10 p-6">
        <h2 className="text-xs font-mono uppercase tracking-widest text-white mb-6">
          Recipient Details
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <Field
            label="Recipient Name"
            value={form.recipientName}
            onChange={(v) => setForm((f) => ({ ...f, recipientName: v }))}
            required
            placeholder="e.g. Sarah Johnson"
          />
          <Field
            label="Company"
            value={form.recipientCompany}
            onChange={(v) => setForm((f) => ({ ...f, recipientCompany: v }))}
            required
            placeholder="e.g. MediaMax Holdings"
          />
          <Field
            label="Role"
            value={form.recipientRole}
            onChange={(v) => setForm((f) => ({ ...f, recipientRole: v }))}
            required
            placeholder="e.g. Marketing Director"
          />

          {/* Industry dropdown */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">
              Industry <span className="text-red-400">*</span>
            </label>
            <select
              value={form.industry}
              onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
              className="w-full bg-neutral-950 border border-white/10 text-white text-sm font-mono px-3 py-2 min-h-[44px] focus:outline-none focus:border-[#D4A843]/50 focus:ring-1 focus:ring-[#D4A843]/30 appearance-none"
            >
              <option value="" className="text-neutral-400">
                Select industry...
              </option>
              {INDUSTRIES.map((ind) => (
                <option key={ind} value={ind}>
                  {ind}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Services checkboxes */}
        <div className="mb-4">
          <label className="block text-xs font-mono uppercase tracking-widest text-neutral-400 mb-3">
            Services Fit
          </label>
          <div className="flex flex-wrap gap-3">
            {SERVICES.map((service) => (
              <label
                key={service}
                className="flex items-center gap-2 cursor-pointer min-h-[44px] px-3 select-none"
              >
                <input
                  type="checkbox"
                  checked={form.servicesFit.includes(service)}
                  onChange={() => toggleService(service)}
                  className="accent-[#D4A843] w-4 h-4"
                />
                <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                  {service}
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs font-mono text-neutral-400 mt-1">
            Leave empty to default to Photography and Video Production.
          </p>
        </div>

        {/* Custom context */}
        <div className="mb-6">
          <label className="block text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">
            Custom Context
          </label>
          <textarea
            value={form.customContext}
            onChange={(e) => setForm((f) => ({ ...f, customContext: e.target.value }))}
            rows={3}
            placeholder="Any additional context about the prospect or approach..."
            className="w-full bg-neutral-950 border border-white/10 text-white text-sm font-mono px-3 py-2 focus:outline-none focus:border-[#D4A843]/50 focus:ring-1 focus:ring-[#D4A843]/30 resize-none placeholder:text-neutral-400"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={generate}
            disabled={!canSubmit || loading}
            className="flex items-center gap-2 px-5 py-2 min-h-[44px] bg-[#D4A843] text-black text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Send className="w-3 h-3" />
            )}
            {loading ? 'Generating...' : 'Generate Outreach'}
          </button>
          <button
            onClick={reset}
            className="flex items-center gap-2 px-5 py-2 min-h-[44px] border border-white/20 text-xs font-mono uppercase tracking-widest text-neutral-400 hover:text-white hover:border-white/40 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Clear
          </button>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-20 gap-2 text-neutral-400 font-mono text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Generating outreach emails...
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div className="bg-neutral-900 border border-white/10 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xs font-mono uppercase tracking-widest text-white">
              Generated Emails for {result.recipient}
            </h2>
            <button
              onClick={() => copyToClipboard(result.emails)}
              className="flex items-center gap-2 px-4 py-2 min-h-[44px] border border-white/20 text-xs font-mono uppercase tracking-widest text-neutral-400 hover:text-white hover:border-white/40 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  Copy All
                </>
              )}
            </button>
          </div>

          {(() => {
            const drafts = splitDrafts(result.emails);
            if (!drafts.length) {
              return (
                <div className="bg-neutral-950 border border-white/5 p-4 md:p-6 overflow-x-auto">
                  <pre className="text-sm text-neutral-300 whitespace-pre-wrap leading-relaxed">{result.emails}</pre>
                </div>
              );
            }
            return (
              <div className="space-y-4">
                {drafts.map((d, i) => (
                  <div key={i} className="bg-neutral-950 border border-white/5 p-4 md:p-6">
                    <p className="text-xs text-neutral-400">Email {i + 1} · Subject</p>
                    <p className="mt-1 text-base text-white">{d.subject}</p>
                    <p className="mt-4 text-xs text-neutral-400">Message</p>
                    <p className="mt-1 text-sm text-neutral-200 whitespace-pre-wrap leading-relaxed">{d.body}</p>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(`${d.subject}\n\n${d.body}`).catch(() => {})}
                      className="mt-4 inline-flex min-h-[44px] items-center gap-2 border border-white/20 px-4 text-xs text-neutral-300 hover:text-white"
                    >
                      <Copy className="w-3 h-3" /> Copy this email
                    </button>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ─── Shared sub-components ───────────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  required = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-neutral-950 border border-white/10 text-white text-sm font-mono px-3 py-2 min-h-[44px] focus:outline-none focus:border-[#D4A843]/50 focus:ring-1 focus:ring-[#D4A843]/30 placeholder:text-neutral-400"
      />
    </div>
  );
}

/** The helper answers "SUBJECT_1: ... BODY_1: ..."; split that into separate emails. */
function splitDrafts(text: string): { subject: string; body: string }[] {
  const out: { subject: string; body: string }[] = [];
  const re = /SUBJECT_(\d+)\s*:\s*([\s\S]*?)\n\s*BODY_\1\s*:\s*([\s\S]*?)(?=\n\s*SUBJECT_\d+\s*:|$)/g;
  for (const m of text.matchAll(re)) {
    const subject = m[2].replace(/\*\*/g, '').trim();
    const body = m[3].replace(/\*\*/g, '').trim();
    if (subject && body) out.push({ subject, body });
  }
  return out;
}
