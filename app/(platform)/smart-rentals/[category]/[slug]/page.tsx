import { notFound, redirect } from 'next/navigation';
import { getRentalBySlug, getRelatedRentals } from '@/lib/supabase/queries/smartRentals';
import RentalDetailView from './RentalDetailView';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';

export const revalidate = 60;

export default async function RentalDetailPage({
  params,
}: {
  params: Promise<{ category: string; slug: string }>;
}) {
  const { category, slug } = await params;

  if (category === 'crew-services') {
    redirect('/smart-production');
  }

  const rental = await getRentalBySlug(slug);

  if (!rental) notFound();

  const relatedRentals = await getRelatedRentals(rental.category, rental.id, 4);

  return (
    <>
      <RentalDetailView
        rental={rental}
        category={category}
        relatedRentals={relatedRentals}
      />
      <AskUbunyeButton
        prompt={`Tell me more about the ${rental.title} and what it's best for`}
        label="Questions about this gear?"
      />
    </>
  );
}
