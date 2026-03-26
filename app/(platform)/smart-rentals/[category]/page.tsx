import { getPublishedRentalsByCategory } from '@/lib/supabase/queries/smartRentals';
import { getAvailableCrewWithPortfolio } from '@/lib/supabase/queries/crew';
import RentalCategoryClient from './RentalCategoryClient';
import CrewServicesCategoryClient from './CrewServicesCategoryClient';

export const revalidate = 60;

export default async function RentalCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;

  // Crew services uses a completely different data source + layout
  if (category === 'crew-services') {
    const crew = await getAvailableCrewWithPortfolio();
    return <CrewServicesCategoryClient crew={crew} />;
  }

  const rentals = await getPublishedRentalsByCategory(category);
  return <RentalCategoryClient rentals={rentals} category={category} />;
}
