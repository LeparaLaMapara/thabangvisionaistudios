import { notFound } from 'next/navigation';
import { getRentalBySlug, getRelatedRentals } from '@/lib/supabase/queries/smartRentals';
import { getCrewBySlug, getCrewPortfolio, getCrewReviews } from '@/lib/supabase/queries/crew';
import RentalDetailView from './RentalDetailView';
import CrewServiceDetailView from './CrewServiceDetailView';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';

export const revalidate = 60;

export default async function RentalDetailPage({
  params,
}: {
  params: Promise<{ category: string; slug: string }>;
}) {
  const { category, slug } = await params;

  // Crew services uses a different data source + anonymous detail layout
  if (category === 'crew-services') {
    const crew = await getCrewBySlug(slug);
    if (!crew) notFound();

    const [portfolio, reviews] = await Promise.all([
      getCrewPortfolio(crew.id),
      getCrewReviews(crew.id),
    ]);

    return (
      <>
        <CrewServiceDetailView crew={crew} portfolio={portfolio} reviews={reviews} />
        <AskUbunyeButton
          prompt="Tell me about this creator's work and specializations"
          label="Questions about this creator?"
        />
      </>
    );
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
