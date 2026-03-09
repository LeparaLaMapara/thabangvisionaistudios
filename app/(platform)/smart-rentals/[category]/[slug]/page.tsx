import { notFound } from 'next/navigation';
import { getRentalBySlug, getRelatedRentals } from '@/lib/supabase/queries/smartRentals';
import RentalDetailView from './RentalDetailView';

export const dynamic = 'force-dynamic';

export default async function RentalDetailPage({
  params,
}: {
  params: Promise<{ category: string; slug: string }>;
}) {
  const { category, slug } = await params;
  const rental = await getRentalBySlug(slug);

  if (!rental) notFound();

  const relatedRentals = await getRelatedRentals(rental.category, rental.id, 4);

  return (
    <RentalDetailView
      rental={rental}
      category={category}
      relatedRentals={relatedRentals}
    />
  );
}
