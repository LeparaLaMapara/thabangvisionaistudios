'use client';

import { motion } from 'framer-motion';
import { Sparkles, Camera, Bot, Workflow, ArrowRight, Download } from 'lucide-react';
import Link from 'next/link';
import { STUDIO, RESEARCH_LAB, UBUNYE_STUDIO, CREATOR_JOIN, EARN, PLAN } from '@/lib/constants';
import { collectionPoint } from '@/lib/rental/collection-point';

const HERO_CAPABILITY = {
  title: PLAN.label,
  icon: Bot,
  desc: `Say what you are planning, in plain words. Ubunye, our AI assistant, brings the people, the gear, the dates and the prices together.`,
};

// What you can do on the site today.
const CAPABILITIES = [
  { title: 'Photo and Video Shoots', icon: Sparkles, desc: 'Photography, video and post-production (retouching, colour grading, editing). Pick a package and send your date; we confirm who will shoot it and the full price before you pay.', poweredByAI: false },
  { title: 'Equipment Rentals', icon: Camera, desc: 'Browse cameras, lenses, lighting and sound, see live availability and the full price, and book online. Ubunye can suggest gear for your shoot.', poweredByAI: true },
  { title: 'AI Help for Creators', icon: Workflow, desc: 'Ubunye drafts your profile bio and gear listings from your photos, and suggests rates in line with similar work.', poweredByAI: true },
];

export default function LabContent({ appsLive }: { appsLive: boolean }) {
  return (
    <>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-5xl mb-24">
        <h1 className="text-5xl md:text-8xl font-display font-medium text-white tracking-tighter uppercase mb-8 leading-[0.9]">
          About <span className="text-neutral-400">{STUDIO.name}</span>
        </h1>
        <div className="w-8 h-px bg-[#D4A843] mt-6 mb-8" />
        <p className="text-xl md:text-3xl text-neutral-300 font-light leading-relaxed max-w-4xl">
          {STUDIO.name} is where you book what a shoot needs: the people and the gear. Gear is collected in {STUDIO.location.city} at {collectionPoint()}, and you see the full price before you book. Plan a shoot in plain words and Ubunye, our AI assistant, brings it together.
        </p>
      </motion.div>

      {/* Plan: hero card */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative mb-px border border-[#D4A843]/30 bg-gradient-to-r from-neutral-900 to-neutral-800 p-12 md:p-16 group hover:border-[#D4A843]/60 transition-colors duration-500 shadow-[0_0_30px_rgba(212,168,67,0.08)]"
      >
        <div className="absolute top-6 right-6">
          <span className="text-xs font-mono uppercase tracking-widest text-[#D4A843] border border-[#D4A843]/40 px-3 py-1">
            Assistant
          </span>
        </div>
        <HERO_CAPABILITY.icon className="w-10 h-10 text-[#D4A843] mb-6" />
        <h3 className="text-3xl md:text-4xl font-display uppercase mb-5 text-white tracking-tight">
          {HERO_CAPABILITY.title}
        </h3>
        <p className="text-neutral-400 font-mono text-sm leading-relaxed max-w-3xl">
          {HERO_CAPABILITY.desc}
        </p>
        <div className="w-12 h-px bg-[#D4A843]/40 mt-8 group-hover:w-full transition-all duration-700" />
      </motion.div>

      {/* What you can do today: 3 cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/10 border border-white/10 mb-32">
        {CAPABILITIES.map((item, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ delay: i * 0.1 }}
            className="bg-[#0A0A0B] p-12 group hover:bg-white/5 transition-colors flex flex-col justify-between h-80"
          >
            <div>
              <item.icon className="w-8 h-8 text-white mb-6 opacity-80" />
              <h3 className="text-2xl font-display uppercase mb-4 text-white tracking-tight">
                {item.title}
              </h3>
              <p className="text-neutral-400 font-mono text-xs leading-relaxed">{item.desc}</p>
            </div>
            <div className="mt-8 flex flex-col gap-3">
              <div className="w-8 h-px bg-white/20 group-hover:w-full transition-all duration-500" />
              {item.poweredByAI && (
                <span className="text-xs font-mono uppercase tracking-widest text-[#D4A843]">
                  Powered by Ubunye AI
                </span>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* From the lab: the research lab and what it makes */}
      <section aria-labelledby="lab-heading" className="mb-32">
        <p className="text-xs font-mono uppercase tracking-widest text-[#D4A843] mb-4">From the lab</p>
        <h2 id="lab-heading" className="text-3xl md:text-5xl font-display font-medium text-white tracking-tight mb-6">
          {RESEARCH_LAB.name}
        </h2>
        <p className="text-xl md:text-2xl text-neutral-200 font-light leading-relaxed max-w-3xl mb-4">{RESEARCH_LAB.line}</p>
        <p className="text-neutral-400 font-mono text-sm leading-relaxed max-w-3xl mb-8">{RESEARCH_LAB.why}</p>
        <a href={RESEARCH_LAB.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 min-h-[44px] text-xs font-mono uppercase tracking-widest text-[#D4A843] hover:opacity-80">
          About the lab <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </a>

        {/* The free apps only: the in-research editor card is hidden until it ships (owner rule: hide unfinished features). */}
        <div className="mt-10 grid grid-cols-1 gap-px bg-white/10 border border-white/10">
          <div className="bg-[#0A0A0B] p-10 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-6">
                <Download className="w-8 h-8 text-white opacity-80" aria-hidden="true" />
                <span className="text-xs font-mono uppercase tracking-widest text-[#D4A843] border border-[#D4A843]/40 px-3 py-1">
                  Free · {UBUNYE_STUDIO.statusLabels[UBUNYE_STUDIO.status]}
                </span>
              </div>
              <h3 className="text-2xl font-display uppercase mb-4 text-white tracking-tight">{UBUNYE_STUDIO.suiteName}</h3>
              <p className="text-neutral-400 font-mono text-xs leading-relaxed">{UBUNYE_STUDIO.intro}</p>
            </div>
            {appsLive && (
              <Link href="/tools" className="mt-8 inline-flex items-center gap-2 min-h-[44px] text-xs font-mono uppercase tracking-widest text-white hover:text-[#D4A843]">
                Get the apps <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <div className="bg-[#080808] border border-white/5 p-12 md:p-24 text-center">
        <h2 className="text-3xl md:text-5xl font-display font-bold uppercase mb-8 text-white">Ready to build something?</h2>
        <p className="text-neutral-400 mb-12 max-w-xl mx-auto font-mono text-sm">
          Renting gear, planning a shoot, or want to get booked? We&apos;d love to hear from you.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link href="/contact" className="inline-flex items-center gap-3 bg-[#D4A843] text-black px-8 py-4 min-h-[44px] text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity">
            Get In Touch <ArrowRight className="w-4 h-4" />
          </Link>
          <Link href={EARN.href} className="inline-flex items-center gap-3 border border-white/20 text-white px-8 py-4 min-h-[44px] text-xs font-mono font-bold uppercase tracking-widest hover:border-[#D4A843] transition-colors">
            {CREATOR_JOIN.footerLabel} <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </>
  );
}
