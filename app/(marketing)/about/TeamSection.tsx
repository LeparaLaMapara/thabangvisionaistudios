'use client';

import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { CREATOR_JOIN } from '@/lib/constants';

// The three department cards (Creative, Operations, Engineering) and the
// "Our network" header were removed on 2026-09-28: they described staffed
// departments and a supplier network that do not exist yet. The featured
// creator cards were removed on 2026-10-15 (owner): named profiles with an
// hourly rate broke the blind People rule.

// ─── Component ───────────────────────────────────────────────────────────────

export default function TeamSection() {
  return (
    <section id="team" className="scroll-mt-24">
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
            href={CREATOR_JOIN.href}
            className="inline-flex items-center justify-center gap-3 border border-white/20 text-white px-8 py-4 text-xs font-mono font-bold uppercase tracking-widest hover:border-white/50 transition-colors"
          >
            {CREATOR_JOIN.footerLabel} <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </motion.div>
    </section>
  );
}
