'use client';

import { motion } from 'framer-motion';
import { ArrowRight, Users } from 'lucide-react';
import Link from 'next/link';
import { STUDIO } from '@/lib/constants';
import CreatorCard from '@/components/creators/CreatorCard';
import type { CreatorProfile } from '@/lib/supabase/queries/smartProductions';

// The three department cards (Creative, Operations, Engineering) and the
// "Our network" header were removed on 2026-09-28: they described staffed
// departments and a supplier network that do not exist yet. Creators appear
// here only once real profiles are published.

// ─── Component ───────────────────────────────────────────────────────────────

export default function TeamSection({
  featuredCrew,
}: {
  featuredCrew: CreatorProfile[];
}) {
  return (
    <section id="team" className="scroll-mt-24">
      {/* Section Header: only when there are real creators to show */}
      {featuredCrew.length > 0 && (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        viewport={{ once: true }}
        className="max-w-5xl mb-20"
      >
        <span className="text-xs font-mono text-[#D4A843] uppercase tracking-[0.3em] mb-4 block">
          The People
        </span>
        <h2 className="text-5xl md:text-8xl font-display font-medium text-white tracking-tighter uppercase mb-8 leading-[0.9]">
          Our <span className="text-neutral-400">Network</span>
        </h2>
        <p className="text-xl md:text-2xl text-neutral-300 font-light leading-relaxed max-w-4xl">
          The photographers and videographers who work with {STUDIO.shortName}.
        </p>
      </motion.div>
      )}

      {/* Featured Crew Cards */}
      {featuredCrew.length > 0 && (
        <div className="mb-16">
          <div className="flex items-center justify-between mb-8">
            <span className="flex items-center gap-2 text-xs font-mono text-neutral-400 uppercase tracking-widest">
              <Users className="w-3 h-3" />
              Featured Creators
            </span>
            <Link
              href="/studio"
              className="text-xs font-mono uppercase tracking-widest text-[#D4A843] hover:text-white transition-colors flex items-center gap-1"
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
        <p className="text-neutral-400 mb-8 max-w-lg mx-auto font-mono text-sm">
          We&apos;re always glad to hear from creatives, engineers and production people.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/careers"
            className="inline-flex items-center justify-center gap-3 bg-[#D4A843] text-black px-8 py-4 text-xs font-mono font-bold uppercase tracking-widest hover:opacity-80 transition-opacity"
          >
            Open Positions <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/onboarding"
            className="inline-flex items-center justify-center gap-3 border border-white/20 text-white px-8 py-4 text-xs font-mono font-bold uppercase tracking-widest hover:border-white/50 transition-colors"
          >
            Become a Creator <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </motion.div>
    </section>
  );
}
