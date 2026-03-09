'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';

export default function TechSupportPage() {
  const [ticketState, setTicketState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTicketState('sending');
    setErrorMsg('');

    const form = e.currentTarget;
    const formData = new FormData(form);
    const urgency = formData.get('urgency') as string;
    const assetId = formData.get('assetId') as string;
    const description = formData.get('description') as string;
    const email = formData.get('email') as string;

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: assetId || 'N/A',
          email,
          subject: `Tech Support: ${urgency} - ${assetId || 'General'}`,
          message: `Urgency: ${urgency}\nAsset ID: ${assetId || 'N/A'}\n\n${description}`,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to submit ticket');
      }

      setTicketState('sent');
      form.reset();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setTicketState('error');
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] pt-32 pb-20 transition-colors duration-500">
      <div className="container mx-auto px-6">
         <div className="flex flex-col md:flex-row justify-between items-end mb-16">
            <div>
              <span className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-4 block">00 // System Diagnostics</span>
              <h1 className="text-4xl md:text-6xl font-display font-medium text-black dark:text-white tracking-tighter uppercase">
                Technical Support
              </h1>
            </div>
            <div className="bg-green-500/10 border border-green-500/20 px-4 py-2 flex items-center gap-2 mt-4 md:mt-0">
               <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
               <span className="text-[10px] font-mono font-bold text-green-600 dark:text-green-400 uppercase tracking-widest">
                 Support Available
               </span>
            </div>
         </div>

         <div className="max-w-3xl mx-auto">
            {/* Ticket Form */}
            <div>
               <div className="bg-white dark:bg-[#0A0A0B] border border-black/10 dark:border-white/10 p-8 md:p-12">
                  <h3 className="text-xl font-display font-medium uppercase mb-8 text-black dark:text-white">Submit Support Ticket</h3>

                  {ticketState === 'sent' ? (
                     <div className="text-center py-12">
                        <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-6" />
                        <h4 className="text-2xl font-display uppercase mb-2 text-black dark:text-white">Ticket Submitted</h4>
                        <p className="text-neutral-500 font-mono text-sm">
                          Your support request has been received. We&apos;ll get back to you via email as soon as possible.
                        </p>
                        <button
                          onClick={() => setTicketState('idle')}
                          className="mt-8 text-xs underline uppercase font-bold text-black dark:text-white"
                        >
                          Submit Another Ticket
                        </button>
                     </div>
                  ) : (
                     <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                           <div>
                              <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">Serial Number / Asset ID</label>
                              <input name="assetId" type="text" className="w-full bg-neutral-100 dark:bg-neutral-900 border border-black/10 dark:border-white/10 p-3 font-mono text-sm text-black dark:text-white" placeholder="e.g. CAM-A-042" />
                           </div>
                           <div>
                              <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">Urgency Level</label>
                              <select name="urgency" className="w-full bg-neutral-100 dark:bg-neutral-900 border border-black/10 dark:border-white/10 p-3 font-mono text-sm uppercase text-black dark:text-white">
                                 <option>Low - Question</option>
                                 <option>Medium - Performance Issue</option>
                                 <option>High - On Set Stoppage</option>
                              </select>
                           </div>
                        </div>
                        <div>
                           <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">Issue Description</label>
                           <textarea name="description" required rows={5} className="w-full bg-neutral-100 dark:bg-neutral-900 border border-black/10 dark:border-white/10 p-3 font-mono text-sm text-black dark:text-white" placeholder="Describe the technical fault..." />
                        </div>
                        <div>
                           <label className="block text-[10px] font-bold uppercase tracking-widest text-neutral-500 mb-2">Contact Email</label>
                           <input name="email" type="email" required className="w-full bg-neutral-100 dark:bg-neutral-900 border border-black/10 dark:border-white/10 p-3 font-mono text-sm text-black dark:text-white" />
                        </div>

                        {ticketState === 'error' && errorMsg && (
                          <p className="text-sm font-mono text-red-500">{errorMsg}</p>
                        )}

                        <button
                          type="submit"
                          disabled={ticketState === 'sending'}
                          className="bg-black text-white dark:bg-white dark:text-black px-8 py-4 text-xs font-mono font-bold tracking-widest uppercase hover:opacity-80 transition-opacity w-full md:w-auto disabled:opacity-50"
                        >
                           {ticketState === 'sending' ? 'Submitting...' : 'Submit Ticket'}
                        </button>
                     </form>
                  )}
               </div>
            </div>
         </div>
      </div>
    </div>
  );
}
