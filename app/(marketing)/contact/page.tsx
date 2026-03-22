'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Mail, Phone, MapPin, Send, Loader2 } from 'lucide-react';
import { STUDIO } from '@/lib/constants';

export default function ContactPage() {
  const [formState, setFormState] = useState({ name: '', email: '', subject: 'Project Inquiry', message: '', _hp_company: '' });
  const [pageLoadTs] = useState(() => Date.now());
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
        body: JSON.stringify({ ...formState, _ts: pageLoadTs }),
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
    <div className="min-h-screen bg-[#050505] pt-32 pb-20">
      <div className="container mx-auto px-6">

        {/* Header */}
        <div className="max-w-4xl mb-20">
          <span className="text-[10px] font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-4 block">Get In Touch</span>
          <h1 className="text-5xl md:text-8xl font-display font-medium text-white tracking-tighter uppercase mb-8 leading-[0.9]">
            Contact <span className="text-neutral-500">Us</span>
          </h1>
          <div className="w-8 h-px bg-[#D4A843] mt-6" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16">

          {/* Contact Form */}
          <div className="lg:col-span-7">
            {isSubmitted ? (
               <motion.div
                 initial={{ opacity: 0 }}
                 animate={{ opacity: 1 }}
                 className="bg-[#0A0A0B] border border-white/5 p-12 text-center"
               >
                 <div className="w-16 h-16 bg-[#D4A843] flex items-center justify-center mx-auto mb-6">
                    <Send className="text-black w-6 h-6" />
                 </div>
                 <h3 className="text-2xl font-display uppercase mb-2 text-white">Message Sent</h3>
                 <p className="text-neutral-500 font-mono text-sm">We&apos;ll get back to you within 24 hours.</p>
                 <button
                   onClick={() => setIsSubmitted(false)}
                   className="mt-8 text-xs font-mono font-bold uppercase tracking-widest text-[#D4A843] hover:text-[#D4A843]/80 transition-colors"
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
                    className="bg-red-950/30 border border-red-800 p-4 flex items-start justify-between gap-4"
                  >
                    <p className="text-red-400 font-mono text-sm">{error}</p>
                    <button
                      type="button"
                      onClick={() => setError(null)}
                      className="text-red-500 hover:text-red-300 text-xs font-bold uppercase shrink-0"
                    >
                      Dismiss
                    </button>
                  </motion.div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500">Name</label>
                    <input
                      type="text"
                      required
                      placeholder="Your full name"
                      className="w-full bg-transparent border-b border-white/20 py-4 text-white focus:border-[#D4A843] outline-none transition-colors font-mono text-sm placeholder:text-neutral-700"
                      value={formState.name}
                      onChange={e => setFormState({...formState, name: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500">Email</label>
                    <input
                      type="email"
                      required
                      placeholder="you@example.com"
                      className="w-full bg-transparent border-b border-white/20 py-4 text-white focus:border-[#D4A843] outline-none transition-colors font-mono text-sm placeholder:text-neutral-700"
                      value={formState.email}
                      onChange={e => setFormState({...formState, email: e.target.value})}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500">Subject</label>
                  <select
                    className="w-full bg-transparent border-b border-white/20 py-4 text-white focus:border-[#D4A843] outline-none transition-colors font-mono text-sm uppercase appearance-none"
                    value={formState.subject}
                    onChange={e => setFormState({...formState, subject: e.target.value})}
                  >
                    <option className="bg-[#050505]">Project Inquiry</option>
                    <option className="bg-[#050505]">Equipment Rental</option>
                    <option className="bg-[#050505]">Hire a Creator</option>
                    <option className="bg-[#050505]">Press / Media</option>
                    <option className="bg-[#050505]">Other</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500">Message</label>
                  <textarea
                    required
                    rows={6}
                    placeholder="Tell us about your project..."
                    className="w-full bg-transparent border-b border-white/20 py-4 text-white focus:border-[#D4A843] outline-none transition-colors font-mono text-sm placeholder:text-neutral-700"
                    value={formState.message}
                    onChange={e => setFormState({...formState, message: e.target.value})}
                  />
                </div>

                {/* Honeypot field */}
                <div className="absolute opacity-0 top-0 left-0 h-0 w-0 -z-10" aria-hidden="true">
                  <label htmlFor="_hp_company">Company</label>
                  <input
                    type="text"
                    id="_hp_company"
                    name="_hp_company"
                    tabIndex={-1}
                    autoComplete="off"
                    value={formState._hp_company}
                    onChange={e => setFormState({...formState, _hp_company: e.target.value})}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="group bg-[#D4A843] text-black px-10 py-5 text-xs font-mono font-bold tracking-[0.2em] uppercase flex items-center gap-4 hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      Sending <Loader2 className="w-4 h-4 animate-spin" />
                    </>
                  ) : (
                    <>
                      Send Message <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>

          {/* Info Column */}
          <div className="lg:col-span-5 space-y-8">
             <div className="bg-[#0A0A0B] p-8 border border-white/5">
                <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-white mb-6">Our Locations</h3>
                <address className="not-italic space-y-4 text-sm text-neutral-400 font-mono">
                   {STUDIO.locations.map((loc) => (
                     <div key={loc.name} className="flex items-start gap-4">
                       <MapPin className="w-4 h-4 mt-1 flex-shrink-0 text-[#D4A843]" />
                       <div>
                         <p className="text-white text-xs font-bold uppercase tracking-widest mb-1">{loc.name}</p>
                         {loc.address && <p>{loc.address}</p>}
                         <p>{loc.city}, {loc.province}</p>
                       </div>
                     </div>
                   ))}
                   <div className="border-t border-white/5 pt-4 space-y-3">
                     {STUDIO.phone && (
                       <div className="flex items-center gap-4">
                         <Phone className="w-4 h-4 flex-shrink-0 text-[#D4A843]" />
                         <a href={`tel:${STUDIO.phone}`} className="hover:text-white transition-colors">{STUDIO.phone}</a>
                       </div>
                     )}
                     <div className="flex items-center gap-4">
                       <Mail className="w-4 h-4 flex-shrink-0 text-[#D4A843]" />
                       <a href={`mailto:${STUDIO.email}`} className="hover:text-white transition-colors">{STUDIO.email}</a>
                     </div>
                   </div>
                </address>
             </div>
          </div>

        </div>
      </div>
    </div>
  );
}
