import LabContent from './LabContent';
import { getFlag } from '@/lib/features';
import TeamSection from './TeamSection';

export default async function LabPage() {
  // The free apps link only when they are switched on (same flag as the nav).
  const appsLive = await getFlag('creative_tools');

  return (
    <div className="min-h-screen bg-[#050505] pt-32 pb-20">
      <div className="container mx-auto px-6">
        {/* Section 1: The Lab — R&D + Capabilities */}
        <LabContent appsLive={appsLive} />

        {/* Section 2: Join the team. No named creator cards here: people are
            shown blind on /people, judged on their work (owner, 2026-10-15). */}
        <div className="mt-32">
          <TeamSection />
        </div>
      </div>
    </div>
  );
}
