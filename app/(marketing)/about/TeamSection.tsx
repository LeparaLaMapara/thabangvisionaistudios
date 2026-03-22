'use client';

import { motion } from 'framer-motion';
import { Palette, FlaskConical, Cpu, ArrowRight, Users } from 'lucide-react';
import Link from 'next/link';
import { STUDIO } from '@/lib/constants';
import CreatorCard from '@/components/creators/CreatorCard';
import type { CrewMember } from '@/lib/supabase/queries/crew';

// ─── Discipline Pillars ──────────────────────────────────────────────────────

const DISCIPLINES = [
  {
    icon: Palette,
    title: 'Creative',
    roles: 'Cinematographers, photographers, editors, colorists, art directors',
    desc: 'The visual storytellers who define the look and feel of every production.',
  },
  {
    icon: FlaskConical,
    title: 'Research',
    roles: 'AI/ML scientists, computer vision engineers, data analysts',
    desc: 'Pushing the boundaries of what creative technology can do on the African continent.',
  },
  {
    icon: Cpu,
    title: 'Engineering',
    roles: 'Full-stack developers, DevOps, systems architects, optical engineers',
    desc: 'Building the platforms, tools, and hardware that power every workflow.',
  },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function TeamSection({
  featuredCrew,
}: {
  featuredCrew: CrewMember[];
}) {
  return (
    <section id="team" className="scroll-mt-24">
      {/* Section Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        viewport={{ once: true }}
        className="max-w-5xl mb-20"
      >
        <span className="text-[10px] font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-4 block">
          The People
        </span>
        <h2 className="text-5xl md:text-8xl font-display font-medium text-white tracking-tighter uppercase mb-8 leading-[0.9]">
          Our <span className="text-neutral-600">Team</span>
        </h2>
        <p className="text-xl md:text-2xl text-neutral-300 font-light leading-relaxed max-w-4xl">
          A diverse team spanning creative experts, research scientists, and engineers
          — united by the belief that technology should amplify human creativity, not replace it.
        </p>
      </motion.div>

      {/* Three Discipline Pillars */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/10 border border-white/10 mb-20">
        {DISCIPLINES.map((d, i) => (
          <motion.div
            key={d.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.15, duration: 0.5 }}
            viewport={{ once: true }}
            className="bg-[#0A0A0B] p-10 md:p-12 flex flex-col"
          >
            <d.icon className="w-8 h-8 text-[#D4A843] mb-6" />
            <h3 className="text-2xl font-display uppercase text-white tracking-tight mb-2">
              {d.title}
            </h3>
            <p className="text-[10px] font-mono text-[#D4A843] uppercase tracking-widest mb-4">
              {d.roles}
            </p>
            <p className="text-neutral-500 font-mono text-xs leading-relaxed">
              {d.desc}
            </p>
            <div className="w-8 h-px bg-white/10 mt-auto pt-6" />
          </motion.div>
        ))}
      </div>

      {/* Featured Crew Cards */}
      {featuredCrew.length > 0 && (
        <div className="mb-16">
          <div className="flex items-center justify-between mb-8">
            <span className="flex items-center gap-2 text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
              <Users className="w-3 h-3" />
              Featured Creators
            </span>
            <Link
              href="/smart-creators"
              className="text-[10px] font-mono uppercase tracking-widest text-[#D4A843] hover:text-white transition-colors flex items-center gap-1"
            >
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {featuredCrew.map((member, i) => (
              <motion.div
                key={member.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1, duration: 0.4 }}
                viewport={{ once: true }}
              >
                <CreatorCard member={member} />
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Team CTA */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        className="bg-[#080808] border border-white/5 p-12 md:p-20 text-center"
      >
        <h3 className="text-2xl md:text-4xl font-display font-bold uppercase mb-4 text-white">
          Join the team
        </h3>
        <p className="text-neutral-500 mb-8 max-w-lg mx-auto font-mono text-sm">
          We&apos;re always looking for exceptional creatives, scientists, and engineers
          who want to shape the future of production technology in Africa.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/careers"
            className="inline-flex items-center justify-center gap-3 bg-[#D4A843] text-black px-8 py-4 text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity"
          >
            Open Positions <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/smart-creators"
            className="inline-flex items-center justify-center gap-3 border border-white/20 text-white px-8 py-4 text-xs font-mono font-bold uppercase tracking-widest hover:border-white/50 transition-colors"
          >
            Become a Creator <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </motion.div>
    </section>
  );
}
