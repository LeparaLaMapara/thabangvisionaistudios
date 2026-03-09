'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Mail, Phone, MapPin, Send, Loader2 } from 'lucide-react';
import { STUDIO } from '@/lib/constants';

export default function ContactPage() {
  const [formState, setFormState] = useState({ name: '', email: '', subject: 'Project Inquiry', message: '', website: '' });
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formState),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send');
      setIsSubmitted(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] pt-32 pb-20 transition-colors duration-500">
      <div className="container mx-auto px-6">

        {/* Header */}
        <div className="max-w-4xl mb-20">
          <span className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-4 block">05 // Transmission</span>
          <h1 className="text-5xl md:text-8xl font-display font-medium text-black dark:text-white tracking-tighter uppercase mb-8 leading-[0.9]">
            Initiate <span className="text-neutral-400 dark:text-neutral-600">Contact</span>
          </h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16">

          {/* Contact Form */}
          <div className="lg:col-span-7">
            {isSubmitted ? (
               <motion.div
                 initial={{ opacity: 0 }}
                 animate={{ opacity: 1 }}
                 className="bg-neutral-100 dark:bg-[#0A0A0B] border border-black/5 dark:border-white/5 p-12 text-center"
               >
                 <div className="w-16 h-16 bg-black dark:bg-white rounded-full flex items-center justify-center mx-auto mb-6">
                    <Send className="text-white dark:text-black w-6 h-6" />
                 </div>
                 <h3 className="text-2xl font-display uppercase mb-2 text-black dark:text-white">Transmission Received</h3>
                 <p className="text-neutral-500 font-mono text-sm">Our team will decode your message and respond within 24 hours.</p>
                 <button
                   onClick={() => setIsSubmitted(false)}
                   className="mt-8 text-xs font-bold uppercase tracking-widest underline"
                 >
                   Send Another Message
                 </button>
               </motion.div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-8">
                {/* Error alert */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-4 flex items-start justify-between gap-4"
                  >
                    <p className="text-red-700 dark:text-red-400 font-mono text-sm">{error}</p>
                    <button
                      type="button"
                      onClick={() => setError(null)}
                      className="text-red-500 hover:text-red-700 dark:hover:text-red-300 text-xs font-bold uppercase shrink-0"
                    >
                      Dismiss
                    </button>
                  </motion.div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Identity</label>
                    <input
                      type="text"
                      required
                      placeholder="FULL NAME"
                      className="w-full bg-transparent border-b border-black/20 dark:border-white/20 py-4 text-black dark:text-white focus:border-black dark:focus:border-white outline-none transition-colors font-mono text-sm"
                      value={formState.name}
                      onChange={e => setFormState({...formState, name: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Frequency</label>
                    <input
                      type="email"
                      required
                      placeholder="EMAIL ADDRESS"
                      className="w-full bg-transparent border-b border-black/20 dark:border-white/20 py-4 text-black dark:text-white focus:border-black dark:focus:border-white outline-none transition-colors font-mono text-sm"
                      value={formState.email}
                      onChange={e => setFormState({...formState, email: e.target.value})}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Subject Protocol</label>
                  <select
                    className="w-full bg-transparent border-b border-black/20 dark:border-white/20 py-4 text-black dark:text-white focus:border-black dark:focus:border-white outline-none transition-colors font-mono text-sm uppercase appearance-none"
                    value={formState.subject}
                    onChange={e => setFormState({...formState, subject: e.target.value})}
                  >
                    <option className="bg-white dark:bg-black">Project Inquiry</option>
                    <option className="bg-white dark:bg-black">Equipment Rental</option>
                    <option className="bg-white dark:bg-black">The Lab / R&D</option>
                    <option className="bg-white dark:bg-black">Press / Media</option>
                    <option className="bg-white dark:bg-black">Other</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Transmission Data</label>
                  <textarea
                    required
                    rows={6}
                    placeholder="ENTER MESSAGE..."
                    className="w-full bg-transparent border-b border-black/20 dark:border-white/20 py-4 text-black dark:text-white focus:border-black dark:focus:border-white outline-none transition-colors font-mono text-sm"
                    value={formState.message}
                    onChange={e => setFormState({...formState, message: e.target.value})}
                  />
                </div>

                {/* Honeypot field — hidden from real users, catches bots */}
                <div className="absolute opacity-0 top-0 left-0 h-0 w-0 -z-10" aria-hidden="true">
                  <label htmlFor="website">Website</label>
                  <input
                    type="text"
                    id="website"
                    name="website"
                    tabIndex={-1}
                    autoComplete="off"
                    value={formState.website}
                    onChange={e => setFormState({...formState, website: e.target.value})}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="group bg-black text-white dark:bg-white dark:text-black px-10 py-5 text-xs font-mono font-bold tracking-[0.2em] uppercase flex items-center gap-4 hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      Transmitting <Loader2 className="w-4 h-4 animate-spin" />
                    </>
                  ) : (
                    <>
                      Transmit <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>

          {/* Info Column */}
          <div className="lg:col-span-5 space-y-12">
             <div className="bg-neutral-100 dark:bg-[#0A0A0B] p-8 border border-black/5 dark:border-white/5">
                <h3 className="text-sm font-bold uppercase tracking-widest text-black dark:text-white mb-6">Headquarters</h3>
                <address className="not-italic space-y-4 text-sm text-neutral-600 dark:text-neutral-400 font-mono">
                   <div className="flex items-start gap-4">
                      <MapPin className="w-4 h-4 mt-1 flex-shrink-0" />
                      <div>
                        <p>{STUDIO.locations[0].address || 'Address TBA'}</p>
                        <p>{STUDIO.locations[0].city}, {STUDIO.locations[0].province}</p>
                        <p>{STUDIO.location.country}</p>
                      </div>
                   </div>
                   <div className="flex items-center gap-4">
                      <Phone className="w-4 h-4 flex-shrink-0" />
                      {STUDIO.phone ? <a href={`tel:${STUDIO.phone}`} className="hover:text-black dark:hover:text-white">{STUDIO.phone}</a> : <span className="text-neutral-400">Phone TBA</span>}
                   </div>
                   <div className="flex items-center gap-4">
                      <Mail className="w-4 h-4 flex-shrink-0" />
                      <a href={`mailto:${STUDIO.email}`} className="hover:text-black dark:hover:text-white">{STUDIO.email}</a>
                   </div>
                </address>
             </div>

             <div>
                <h3 className="text-sm font-bold uppercase tracking-widest text-black dark:text-white mb-6">Global Desks</h3>
                <div className="grid grid-cols-2 gap-4">
                   <div className="border-l border-black/20 dark:border-white/20 pl-4">
                      <h4 className="text-xs font-bold uppercase mb-1 text-black dark:text-white">Cape Town</h4>
                      <p className="text-[10px] font-mono text-neutral-500">Film Studios, Unit 4</p>
                   </div>
                   <div className="border-l border-black/20 dark:border-white/20 pl-4">
                      <h4 className="text-xs font-bold uppercase mb-1 text-black dark:text-white">Los Angeles</h4>
                      <p className="text-[10px] font-mono text-neutral-500">Partner Office</p>
                   </div>
                </div>
             </div>

          </div>

        </div>
      </div>
    </div>
  );
}
