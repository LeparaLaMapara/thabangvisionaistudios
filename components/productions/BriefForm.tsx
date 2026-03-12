'use client';

import { useState, type FormEvent } from 'react';

const PRODUCTION_TYPES = [
  'Portrait',
  'Commercial',
  'Wedding',
  'Music Video',
  'Corporate',
  'Documentary',
  'Other',
] as const;

const BUDGET_RANGES = [
  'Under R5,000',
  'R5,000 - R15,000',
  'R15,000 - R30,000',
  'R30,000 - R50,000',
  'R50,000+',
] as const;

type FormData = {
  name: string;
  email: string;
  phone: string;
  productionType: string;
  preferredDates: string;
  budgetRange: string;
  details: string;
};

const initialForm: FormData = {
  name: '',
  email: '',
  phone: '',
  productionType: '',
  preferredDates: '',
  budgetRange: '',
  details: '',
};

export default function BriefForm() {
  const [form, setForm] = useState<FormData>(initialForm);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [ts] = useState(() => Date.now());

  function update(field: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus('submitting');
    setErrorMsg('');

    // Build formatted message body
    const messageParts: string[] = [
      `Production Type: ${form.productionType}`,
      form.preferredDates ? `Preferred Dates: ${form.preferredDates}` : '',
      form.budgetRange ? `Budget Range: ${form.budgetRange}` : '',
      form.phone ? `Phone: ${form.phone}` : '',
      '',
      'Project Details:',
      form.details,
    ].filter(Boolean);

    const message = messageParts.join('\n');

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone || undefined,
          message,
          subject: `Production Brief: ${form.productionType}`,
          _hp_company: honeypot,
          _ts: ts,
        }),
      });

      if (res.ok) {
        setStatus('success');
        setForm(initialForm);
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error || 'Something went wrong. Please try again.');
        setStatus('error');
      }
    } catch {
      setErrorMsg('Network error. Please check your connection and try again.');
      setStatus('error');
    }
  }

  const inputClasses =
    'w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-white placeholder-neutral-500 text-sm focus:outline-none focus:border-[#D4A843] focus:ring-1 focus:ring-[#D4A843] transition-colors';
  const labelClasses = 'block text-sm font-medium text-neutral-300 mb-1.5';

  return (
    <section id="brief" className="py-24 bg-[#050505]">
      <div className="max-w-2xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-12">
          <p className="text-[#D4A843] font-mono text-sm tracking-widest uppercase mb-3">
            Start Your Project
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Submit a Production Brief
          </h2>
          <p className="text-neutral-400">
            Tell us about your project and we&apos;ll get back to you with a
            tailored quote within 24 hours.
          </p>
        </div>

        {/* Success state */}
        {status === 'success' && (
          <div className="rounded-xl border border-emerald-800 bg-emerald-900/20 p-6 text-center mb-8">
            <p className="text-emerald-400 font-semibold text-lg mb-1">
              Brief Submitted Successfully
            </p>
            <p className="text-neutral-400 text-sm">
              We&apos;ll review your brief and respond within 24 hours.
            </p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Honeypot — hidden from real users */}
          <div className="absolute opacity-0 h-0 overflow-hidden" aria-hidden="true">
            <label htmlFor="_hp_company">Company</label>
            <input
              id="_hp_company"
              name="_hp_company"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>

          {/* Name & Email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label htmlFor="brief-name" className={labelClasses}>
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="brief-name"
                type="text"
                required
                placeholder="Your full name"
                className={inputClasses}
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="brief-email" className={labelClasses}>
                Email <span className="text-red-500">*</span>
              </label>
              <input
                id="brief-email"
                type="email"
                required
                placeholder="you@example.com"
                className={inputClasses}
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
              />
            </div>
          </div>

          {/* Phone */}
          <div>
            <label htmlFor="brief-phone" className={labelClasses}>
              Phone <span className="text-neutral-600">(optional)</span>
            </label>
            <input
              id="brief-phone"
              type="tel"
              placeholder="079 000 0000"
              className={inputClasses}
              value={form.phone}
              onChange={(e) => update('phone', e.target.value)}
            />
          </div>

          {/* Production Type & Budget */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label htmlFor="brief-type" className={labelClasses}>
                Production Type <span className="text-red-500">*</span>
              </label>
              <select
                id="brief-type"
                required
                className={inputClasses}
                value={form.productionType}
                onChange={(e) => update('productionType', e.target.value)}
              >
                <option value="" disabled>
                  Select type...
                </option>
                {PRODUCTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="brief-budget" className={labelClasses}>
                Budget Range
              </label>
              <select
                id="brief-budget"
                className={inputClasses}
                value={form.budgetRange}
                onChange={(e) => update('budgetRange', e.target.value)}
              >
                <option value="" disabled>
                  Select range...
                </option>
                {BUDGET_RANGES.map((range) => (
                  <option key={range} value={range}>
                    {range}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Preferred Dates */}
          <div>
            <label htmlFor="brief-dates" className={labelClasses}>
              Preferred Dates
            </label>
            <input
              id="brief-dates"
              type="text"
              placeholder="e.g. March 20-22, flexible weekends"
              className={inputClasses}
              value={form.preferredDates}
              onChange={(e) => update('preferredDates', e.target.value)}
            />
          </div>

          {/* Project Details */}
          <div>
            <label htmlFor="brief-details" className={labelClasses}>
              Project Details <span className="text-red-500">*</span>
            </label>
            <textarea
              id="brief-details"
              required
              rows={5}
              placeholder="Describe your project vision, goals, and any specific requirements..."
              className={`${inputClasses} resize-y`}
              value={form.details}
              onChange={(e) => update('details', e.target.value)}
            />
          </div>

          {/* Error message */}
          {status === 'error' && (
            <p className="text-red-400 text-sm">{errorMsg}</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={status === 'submitting'}
            className="w-full py-3.5 rounded-lg bg-[#D4A843] text-black font-semibold text-sm hover:bg-[#c49a3a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {status === 'submitting' ? 'Submitting...' : 'Submit Brief'}
          </button>
        </form>

        {/* AI help link */}
        <div className="mt-8 text-center">
          <p className="text-neutral-500 text-sm">
            Need help right now?{' '}
            <a
              href="/ubunye-ai-studio"
              className="text-[#D4A843] underline underline-offset-2 hover:text-[#e5be5f] transition-colors"
            >
              Chat with Ubunye AI for an instant quote
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
