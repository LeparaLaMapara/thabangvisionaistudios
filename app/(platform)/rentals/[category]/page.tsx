import { redirect } from 'next/navigation';
import { getPublishedRentalsByCategory } from '@/lib/supabase/queries/smartRentals';
import RentalCategoryClient from './RentalCategoryClient';

export const revalidate = 60;

export default async function RentalCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;

  if (category === 'crew-services') {
    redirect('/studio');
  }

  const rentals = await getPublishedRentalsByCategory(category);
  return <RentalCategoryClient rentals={rentals} category={category} />;
}
