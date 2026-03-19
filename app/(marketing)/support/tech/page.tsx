'use client';

import { useState } from 'react';
import { CheckCircle2, Bug, Lightbulb, AlertTriangle, Monitor, Smartphone } from 'lucide-react';
import { STUDIO } from '@/lib/constants';

const REPORT_TYPES = [
  { value: 'bug', label: 'Bug Report', icon: Bug, desc: 'Something is broken or not working as expected' },
  { value: 'feedback', label: 'Feedback', icon: Lightbulb, desc: 'Suggest an improvement or new feature' },
  { value: 'issue', label: 'Account Issue', icon: AlertTriangle, desc: 'Login, payments, bookings, or profile problems' },
] as const;

export default function PlatformSupportPage() {
  const [ticketState, setTicketState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [reportType, setReportType] = useState<string>('bug');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTicketState('sending');
    setErrorMsg('');

    const form = e.currentTarget;
    const formData = new FormData(form);
    const page = formData.get('page') as string;
    const device = formData.get('device') as string;
    const description = formData.get('description') as string;
    const email = formData.get('email') as string;
    const steps = formData.get('steps') as string;

    const typeLabel = REPORT_TYPES.find(t => t.value === reportType)?.label ?? 'Bug Report';

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Platform ${typeLabel}`,
          email,
          subject: `[${typeLabel}] ${page || 'General'} — ${device || 'Unknown device'}`,
          message: [
            `Type: ${typeLabel}`,
            `Page/Feature: ${page || 'N/A'}`,
            `Device: ${device || 'N/A'}`,
            steps ? `\nSteps to Reproduce:\n${steps}` : '',
            `\nDescription:\n${description}`,
          ].filter(Boolean).join('\n'),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to submit report');
      }

      setTicketState('sent');
      form.reset();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setTicketState('error');
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] pt-32 pb-20">
      <div className="container mx-auto px-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-16 gap-4">
          <div>
            <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest mb-4 block">
              00 // Platform Support
            </span>
            <h1 className="text-4xl md:text-6xl font-display font-medium text-white tracking-tighter uppercase">
              Report an Issue
            </h1>
            <p className="text-neutral-500 font-mono text-sm mt-4 max-w-lg">
              Found a bug? Have feedback? Let us know and we&apos;ll fix it.
              For equipment support, visit us at our{' '}
              <span className="text-white">{STUDIO.location.city} studio</span>.
            </p>
          </div>
          <div className="bg-[#D4A843]/10 border border-[#D4A843]/20 px-4 py-2 flex items-center gap-2 shrink-0">
            <div className="w-2 h-2 rounded-full bg-[#D4A843] animate-pulse" />
            <span className="text-[10px] font-mono font-bold text-[#D4A843] uppercase tracking-widest">
              Listening
            </span>
          </div>
        </div>

        <div className="max-w-3xl mx-auto">
          {/* Report Type Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-white/10 border border-white/10 mb-8">
            {REPORT_TYPES.map((type) => (
              <button
                key={type.value}
                type="button"
                onClick={() => setReportType(type.value)}
                className={`p-6 text-left transition-colors ${
                  reportType === type.value
                    ? 'bg-white/5'
                    : 'bg-[#0A0A0B] hover:bg-white/[0.02]'
                }`}
              >
                <type.icon className={`w-5 h-5 mb-3 ${
                  reportType === type.value ? 'text-[#D4A843]' : 'text-neutral-600'
                }`} />
                <h3 className={`text-sm font-display uppercase font-medium mb-1 ${
                  reportType === type.value ? 'text-white' : 'text-neutral-400'
                }`}>
                  {type.label}
                </h3>
                <p className="text-[10px] font-mono text-neutral-600 leading-relaxed">
                  {type.desc}
                </p>
              </button>
            ))}
          </div>

          {/* Form */}
          <div className="bg-[#0A0A0B] border border-white/10 p-8 md:p-12">
            {ticketState === 'sent' ? (
              <div className="text-center py-12">
                <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-6" />
                <h4 className="text-2xl font-display uppercase mb-2 text-white">
                  Report Received
                </h4>
                <p className="text-neutral-500 font-mono text-sm max-w-md mx-auto">
                  Thanks for helping us improve the platform. We&apos;ll review your report and
                  follow up via email if we need more details.
                </p>
                <button
                  onClick={() => setTicketState('idle')}
                  className="mt-8 text-xs underline uppercase font-bold text-white"
                >
                  Submit Another Report
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
                      Page / Feature
                    </label>
                    <input
                      name="page"
                      type="text"
                      className="w-full bg-neutral-900 border border-white/10 p-3 font-mono text-sm text-white placeholder:text-neutral-700 focus:border-white/30 focus:outline-none transition-colors"
                      placeholder="e.g. Smart Rentals, Dashboard, Checkout"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
                      Device
                    </label>
                    <div className="flex gap-2">
                      <label className="flex-1 cursor-pointer">
                        <input type="radio" name="device" value="Desktop" className="sr-only peer" defaultChecked />
                        <span className="flex items-center justify-center gap-2 w-full bg-neutral-900 border border-white/10 p-3 font-mono text-sm text-neutral-500 peer-checked:text-white peer-checked:border-white/30 transition-colors">
                          <Monitor className="w-4 h-4" /> Desktop
                        </span>
                      </label>
                      <label className="flex-1 cursor-pointer">
                        <input type="radio" name="device" value="Mobile" className="sr-only peer" />
                        <span className="flex items-center justify-center gap-2 w-full bg-neutral-900 border border-white/10 p-3 font-mono text-sm text-neutral-500 peer-checked:text-white peer-checked:border-white/30 transition-colors">
                          <Smartphone className="w-4 h-4" /> Mobile
                        </span>
                      </label>
                    </div>
                  </div>
                </div>

                {reportType === 'bug' && (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
                      Steps to Reproduce
                    </label>
                    <textarea
                      name="steps"
                      rows={3}
                      className="w-full bg-neutral-900 border border-white/10 p-3 font-mono text-sm text-white placeholder:text-neutral-700 focus:border-white/30 focus:outline-none transition-colors"
                      placeholder={"1. Go to Smart Rentals\n2. Click on a rental\n3. The page shows an error"}
                    />
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
                    {reportType === 'feedback' ? 'Your Suggestion' : 'Describe the Issue'}
                  </label>
                  <textarea
                    name="description"
                    required
                    rows={5}
                    className="w-full bg-neutral-900 border border-white/10 p-3 font-mono text-sm text-white placeholder:text-neutral-700 focus:border-white/30 focus:outline-none transition-colors"
                    placeholder={
                      reportType === 'feedback'
                        ? 'Tell us what you would like to see improved or added...'
                        : 'What happened? What did you expect to happen instead?'
                    }
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">
                    Your Email
                  </label>
                  <input
                    name="email"
                    type="email"
                    required
                    className="w-full bg-neutral-900 border border-white/10 p-3 font-mono text-sm text-white placeholder:text-neutral-700 focus:border-white/30 focus:outline-none transition-colors"
                    placeholder="so we can follow up with you"
                  />
                </div>

                {ticketState === 'error' && errorMsg && (
                  <p className="text-sm font-mono text-red-500">{errorMsg}</p>
                )}

                <button
                  type="submit"
                  disabled={ticketState === 'sending'}
                  className="bg-white text-black px-8 py-4 text-xs font-mono font-bold tracking-widest uppercase hover:opacity-80 transition-opacity w-full md:w-auto disabled:opacity-50"
                >
                  {ticketState === 'sending' ? 'Submitting...' : 'Submit Report'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
