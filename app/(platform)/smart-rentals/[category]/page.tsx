import { getPublishedRentalsByCategory } from '@/lib/supabase/queries/smartRentals';
import RentalCategoryClient from './RentalCategoryClient';

export const dynamic = 'force-dynamic';

export default async function RentalCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  const rentals = await getPublishedRentalsByCategory(category);
  return <RentalCategoryClient rentals={rentals} category={category} />;

}
