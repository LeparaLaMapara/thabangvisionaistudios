'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Bug, Send, ArrowLeft, CheckCircle, AlertTriangle } from 'lucide-react';

const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low — Minor issue, workaround exists' },
  { value: 'medium', label: 'Medium — Feature not working correctly' },
  { value: 'high', label: 'High — Major feature broken' },
  { value: 'critical', label: 'Critical — Cannot use the platform' },
] as const;

export default function ReportBugPage() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stepsToReproduce, setStepsToReproduce] = useState('');
  const [expectedBehaviour, setExpectedBehaviour] = useState('');
  const [actualBehaviour, setActualBehaviour] = useState('');
  const [pageUrl, setPageUrl] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        setError('You must be logged in to submit a bug report.');
        setSubmitting(false);
        return;
      }

      const res = await fetch('/api/bug-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          steps_to_reproduce: stepsToReproduce.trim() || undefined,
          expected_behaviour: expectedBehaviour.trim() || undefined,
          actual_behaviour: actualBehaviour.trim() || undefined,
          page_url: pageUrl.trim() || undefined,
          severity,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to submit report');
        return;
      }

      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-20">
        <div className="text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-display font-medium uppercase text-white mb-3">
            Report Submitted
          </h1>
          <p className="text-sm font-mono text-neutral-400 mb-8">
            Thank you for reporting this issue. Our team will investigate and you can track the status from your dashboard.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link
              href="/dashboard"
              className="text-xs font-mono font-bold uppercase tracking-widest px-6 py-3 bg-[#D4A843] text-black hover:bg-[#E5B954] transition-colors"
            >
              Go to Dashboard
            </Link>
            <button
              onClick={() => {
                setSubmitted(false);
                setTitle('');
                setDescription('');
                setStepsToReproduce('');
                setExpectedBehaviour('');
                setActualBehaviour('');
                setPageUrl('');
                setSeverity('medium');
              }}
              className="text-xs font-mono font-bold uppercase tracking-widest px-6 py-3 border border-white/10 text-white hover:border-white/30 transition-colors"
            >
              Report Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      {/* Header */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-neutral-400 hover:text-white transition-colors mb-8"
      >
        <ArrowLeft className="w-3 h-3" /> Back to Dashboard
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <Bug className="w-5 h-5 text-[#D4A843]" />
        <span className="text-xs font-mono text-[#D4A843] uppercase tracking-[0.3em]">
          Support
        </span>
      </div>
      <h1 className="text-2xl md:text-3xl font-display font-medium uppercase text-white mb-2">
        Report a Bug
      </h1>
      <p className="text-sm font-mono text-neutral-400 mb-10">
        Found something broken? Let us know and we&apos;ll fix it.
      </p>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 p-4 mb-6 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs font-mono text-red-400">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Title */}
        <div>
          <label className="block text-xs font-mono font-bold uppercase tracking-widest text-neutral-300 mb-2">
            Title <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Brief description of the issue"
            required
            minLength={3}
            className="w-full bg-[#0A0A0B] border border-white/10 px-4 py-3 text-sm font-mono text-white placeholder:text-neutral-400 focus:border-[#D4A843]/50 focus:outline-none transition-colors"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-mono font-bold uppercase tracking-widest text-neutral-300 mb-2">
            Description <span className="text-red-400">*</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What happened? Include as much detail as possible."
            required
            minLength={10}
            rows={4}
            className="w-full bg-[#0A0A0B] border border-white/10 px-4 py-3 text-sm font-mono text-white placeholder:text-neutral-400 focus:border-[#D4A843]/50 focus:outline-none transition-colors resize-y"
          />
        </div>

        {/* Steps to reproduce */}
        <div>
          <label className="block text-xs font-mono font-bold uppercase tracking-widest text-neutral-300 mb-2">
            Steps to Reproduce <span className="text-neutral-400">(optional)</span>
          </label>
          <textarea
            value={stepsToReproduce}
            onChange={(e) => setStepsToReproduce(e.target.value)}
            placeholder="1. Go to...&#10;2. Click on...&#10;3. See error..."
            rows={3}
            className="w-full bg-[#0A0A0B] border border-white/10 px-4 py-3 text-sm font-mono text-white placeholder:text-neutral-400 focus:border-[#D4A843]/50 focus:outline-none transition-colors resize-y"
          />
        </div>

        {/* Expected vs Actual */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-mono font-bold uppercase tracking-widest text-neutral-300 mb-2">
              Expected <span className="text-neutral-400">(optional)</span>
            </label>
            <textarea
              value={expectedBehaviour}
              onChange={(e) => setExpectedBehaviour(e.target.value)}
              placeholder="What should have happened?"
              rows={2}
              className="w-full bg-[#0A0A0B] border border-white/10 px-4 py-3 text-sm font-mono text-white placeholder:text-neutral-400 focus:border-[#D4A843]/50 focus:outline-none transition-colors resize-y"
            />
          </div>
          <div>
            <label className="block text-xs font-mono font-bold uppercase tracking-widest text-neutral-300 mb-2">
              Actual <span className="text-neutral-400">(optional)</span>
            </label>
            <textarea
              value={actualBehaviour}
              onChange={(e) => setActualBehaviour(e.target.value)}
              placeholder="What actually happened?"
              rows={2}
              className="w-full bg-[#0A0A0B] border border-white/10 px-4 py-3 text-sm font-mono text-white placeholder:text-neutral-400 focus:border-[#D4A843]/50 focus:outline-none transition-colors resize-y"
            />
          </div>
        </div>

        {/* Page URL */}
        <div>
          <label className="block text-xs font-mono font-bold uppercase tracking-widest text-neutral-300 mb-2">
            Page URL <span className="text-neutral-400">(optional)</span>
          </label>
          <input
            type="text"
            value={pageUrl}
            onChange={(e) => setPageUrl(e.target.value)}
            placeholder="https://thabangvision.com/..."
            className="w-full bg-[#0A0A0B] border border-white/10 px-4 py-3 text-sm font-mono text-white placeholder:text-neutral-400 focus:border-[#D4A843]/50 focus:outline-none transition-colors"
          />
        </div>

        {/* Severity */}
        <div>
          <label className="block text-xs font-mono font-bold uppercase tracking-widest text-neutral-300 mb-2">
            Severity
          </label>
          <div className="space-y-2">
            {SEVERITY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-center gap-3 p-3 border cursor-pointer transition-colors ${
                  severity === opt.value
                    ? 'border-[#D4A843]/50 bg-[#D4A843]/5'
                    : 'border-white/5 hover:border-white/10'
                }`}
              >
                <input
                  type="radio"
                  name="severity"
                  value={opt.value}
                  checked={severity === opt.value}
                  onChange={() => setSeverity(opt.value)}
                  className="sr-only"
                />
                <div
                  className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${
                    severity === opt.value
                      ? 'border-[#D4A843] bg-[#D4A843]'
                      : 'border-neutral-600'
                  }`}
                />
                <span className="text-xs font-mono text-neutral-300">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting || title.trim().length < 3 || description.trim().length < 10}
          className="w-full flex items-center justify-center gap-2 text-xs font-mono font-bold uppercase tracking-widest px-6 py-4 bg-[#D4A843] text-black hover:bg-[#E5B954] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? (
            'Submitting...'
          ) : (
            <>
              <Send className="w-3.5 h-3.5" />
              Submit Bug Report
            </>
          )}
        </button>
      </form>
    </div>
  );
}
