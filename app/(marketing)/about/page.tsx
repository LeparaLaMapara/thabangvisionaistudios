import { getPublishedCreatorProfiles } from '@/lib/supabase/queries/smartProductions';
import LabContent from './LabContent';
import { getFlag } from '@/lib/features';
import TeamSection from './TeamSection';

export default async function LabPage() {
  // Fetch featured crew — fallback to first 8 if none are featured
  const allCrew = await getPublishedCreatorProfiles();
  const featured = allCrew.filter(c => c.crew_featured);
  const featuredCrew = featured.length > 0 ? featured.slice(0, 8) : allCrew.slice(0, 8);
  // The free apps link only when they are switched on (same flag as the nav).
  const appsLive = await getFlag('creative_tools');

  return (
    <div className="min-h-screen bg-[#050505] pt-32 pb-20">
      <div className="container mx-auto px-6">
        {/* Section 1: The Lab — R&D + Capabilities */}
        <LabContent appsLive={appsLive} />

        {/* Section 2: Featured creators (only real published profiles) */}
        <div className="mt-32">
          <TeamSection featuredCrew={featuredCrew} />
        </div>
      </div>
    </div>
  );
}
