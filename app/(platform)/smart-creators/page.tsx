export const dynamic = 'force-dynamic';

import { Metadata } from 'next';
import Link from 'next/link';
import { getAvailableCrew } from '@/lib/supabase/queries/crew';
import { STUDIO } from '@/lib/constants';
import CreatorCard from '@/components/creators/CreatorCard';
import CreatorFilter from '@/components/creators/CreatorFilter';

export const metadata: Metadata = {
  title: `Smart Creators | ${STUDIO.shortName}`,
  description: 'Find verified creative professionals for your next production.',
};

export default async function SmartCreatorsPage() {
  const creators = await getAvailableCrew();

  return (
    <div className="max-w-7xl mx-auto px-6 py-16">
      {/* Header */}
      <div className="mb-12">
        <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#D4A843] mb-3">
          {STUDIO.shortName.toUpperCase()}
        </p>
        <h1 className="text-4xl md:text-5xl font-display font-medium uppercase tracking-tight text-white">
          Smart Creators
        </h1>
        <p className="text-sm font-mono text-neutral-500 mt-3 max-w-xl leading-relaxed">
          Find verified professionals for your next production. All creators are identity-verified and vetted by {STUDIO.shortName}.
        </p>
        <div className="w-8 h-px bg-[#D4A843] mt-6" />
      </div>

      {/* Filter + Grid */}
      <CreatorFilter creators={creators} />

      {/* CTA */}
      <div className="mt-16 text-center">
        <div className="inline-block bg-[#0A0A0B] border border-white/10 p-8 max-w-md">
          <p className="text-sm font-mono font-bold uppercase tracking-widest text-white mb-2">
            Need Help Choosing?
          </p>
          <p className="text-xs font-mono text-neutral-500 mb-5 leading-relaxed">
            Tell Ubunye what you need and get matched with the right creator instantly.
          </p>
          <Link
            href="/ubunye-ai-studio?prompt=I%27m%20looking%20for%20a%20creator%20for%20my%20project"
            className="inline-block text-[10px] font-mono font-bold uppercase tracking-widest bg-[#D4A843] text-black px-6 py-3 hover:opacity-80 transition-opacity"
          >
            Ask Ubunye
          </Link>
        </div>
      </div>
    </div>
  );
}
