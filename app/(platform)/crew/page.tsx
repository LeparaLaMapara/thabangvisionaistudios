export const dynamic = 'force-dynamic';

import { Metadata } from 'next';
import Link from 'next/link';
import { getAvailableCrew } from '@/lib/supabase/queries/crew';
import { STUDIO } from '@/lib/constants';
import CrewCard from '@/components/crew/CrewCard';
import CrewFilter from '@/components/crew/CrewFilter';

export const metadata: Metadata = {
  title: `Crew & Talent | ${STUDIO.shortName}`,
  description: 'Find verified creative professionals for your next production.',
};

export default async function CrewPage() {
  const crew = await getAvailableCrew();

  return (
    <div className="max-w-7xl mx-auto px-6 py-16">
      {/* Header */}
      <div className="mb-12">
        <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-600 mb-3">
          {STUDIO.shortName.toUpperCase()}
        </p>
        <h1 className="text-4xl md:text-5xl font-display font-medium uppercase tracking-tight text-white">
          Crew & Talent
        </h1>
        <p className="text-sm font-mono text-neutral-500 mt-3 max-w-xl leading-relaxed">
          Find verified professionals for your next production. All crew members are identity-verified and vetted by {STUDIO.shortName}.
        </p>
        <div className="w-8 h-px bg-white mt-6" />
      </div>

      {/* Filter + Grid */}
      <CrewFilter crew={crew} />

      {/* CTA */}
      <div className="mt-16 text-center">
        <div className="inline-block bg-[#0A0A0B] border border-white/10 p-8 max-w-md">
          <p className="text-sm font-mono font-bold uppercase tracking-widest text-white mb-2">
            Need Help Choosing?
          </p>
          <p className="text-xs font-mono text-neutral-500 mb-5 leading-relaxed">
            Tell Ubunye what you need and get matched with the right crew instantly.
          </p>
          <Link
            href="/ubunye-ai-studio?prompt=I%27m%20looking%20for%20crew%20for%20my%20project"
            className="inline-block text-[10px] font-mono font-bold uppercase tracking-widest bg-white text-black px-6 py-3 hover:opacity-80 transition-opacity"
          >
            Ask Ubunye
          </Link>
        </div>
      </div>
    </div>
  );
}
