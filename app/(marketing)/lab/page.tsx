import { getAvailableCrew } from '@/lib/supabase/queries/crew';
import LabContent from './LabContent';
import TeamSection from './TeamSection';

export default async function LabPage() {
  // Fetch featured crew — fallback to first 8 if none are featured
  const allCrew = await getAvailableCrew();
  const featured = allCrew.filter(c => c.crew_featured);
  const featuredCrew = featured.length > 0 ? featured.slice(0, 8) : allCrew.slice(0, 8);

  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] pt-32 pb-20 transition-colors duration-500">
      <div className="container mx-auto px-6">
        {/* Section 1: The Lab — R&D + Capabilities */}
        <LabContent />

        {/* Section 2: Our Team — Disciplines + Featured Crew */}
        <div className="mt-32">
          <TeamSection featuredCrew={featuredCrew} />
        </div>
      </div>
    </div>
  );
}
