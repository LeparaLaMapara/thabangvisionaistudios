'use client';

import { motion } from 'framer-motion';
import { Sparkles, Camera, Bot, Store, Workflow, Code, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { STUDIO } from '@/lib/constants';

const HERO_CAPABILITY = {
  title: 'Ubunye AI Studio',
  icon: Bot,
  desc: `The intelligence layer behind ${STUDIO.shortName}. Chat with Ubunye to discover creators, find the right gear, plan productions, get pricing estimates, and manage your projects — all through natural conversation. It connects every part of the platform.`,
};

const CAPABILITIES = [
  { title: 'Production Services', icon: Sparkles, desc: 'Photography, video and post-production (retouching, colour grading, editing), booked as a package or by the hour.', poweredByAI: false },
  { title: 'Equipment Rentals', icon: Camera, desc: 'Browse cameras, lenses, lighting and sound, see live availability and the full price, and book online. Ubunye can suggest gear for your shoot.', poweredByAI: true },
  { title: 'Creator Network', icon: Store, desc: 'A vetted supplier network of South African creators and gear owners. Productions book through ThabangVision, and we match the right crew and equipment to the job.', poweredByAI: true },
  { title: 'AI Help for Creators', icon: Workflow, desc: 'Ubunye drafts your profile bio and gear listings from your photos, and suggests rates in line with similar work.', poweredByAI: true },
  { title: 'Coming: Ubunye Studio', icon: Code, desc: 'An AI video and photo editor for creators is in development under the ThabangVision name. It is not part of this site yet.', poweredByAI: false },
];

export default function LabContent() {
  return (
    <>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-5xl mb-24">
        <span className="text-[10px] font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-4 block">Our Platform</span>
        <h1 className="text-5xl md:text-8xl font-display font-medium text-white tracking-tighter uppercase mb-8 leading-[0.9]">
          The <span className="text-neutral-400">Lab</span>
        </h1>
        <div className="w-8 h-px bg-[#D4A843] mt-6 mb-8" />
        <p className="text-xl md:text-3xl text-neutral-300 font-light leading-relaxed max-w-4xl">
          {STUDIO.name} is a Johannesburg platform to book photographers and videographers and hire camera gear. You see the full price before you pay, and Ubunye, our AI assistant, helps you choose. You get hired for the work you make, not who you know.
        </p>
      </motion.div>

      {/* Ubunye AI Studio — Hero Card */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative mb-px border border-[#D4A843]/30 bg-gradient-to-r from-neutral-900 to-neutral-800 p-12 md:p-16 group hover:border-[#D4A843]/60 transition-colors duration-500 shadow-[0_0_30px_rgba(212,168,67,0.08)]"
      >
        <div className="absolute top-6 right-6">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[#D4A843] border border-[#D4A843]/40 px-3 py-1">
            Core Platform
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

      {/* 6 Capability Cards — 3x2 Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-white/10 border border-white/10 mb-32">
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
                <span className="text-[10px] font-mono uppercase tracking-widest text-[#D4A843]">
                  Powered by Ubunye AI
                </span>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* CTA Section */}
      <div className="bg-[#080808] border border-white/5 p-12 md:p-24 text-center">
        <h2 className="text-3xl md:text-5xl font-display font-bold uppercase mb-8 text-white">Ready to build something?</h2>
        <p className="text-neutral-400 mb-12 max-w-xl mx-auto font-mono text-sm">
          Whether you&apos;re a creator, production house, or studio — we&apos;d love to hear about your next project.
        </p>
        <Link href="/contact" className="inline-flex items-center gap-3 bg-[#D4A843] text-black px-8 py-4 text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity">
          Get In Touch <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </>
  );
}
