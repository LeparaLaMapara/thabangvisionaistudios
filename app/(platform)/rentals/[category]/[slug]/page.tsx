import { notFound, redirect } from 'next/navigation';
import { getRentalBySlug, getRelatedRentals } from '@/lib/supabase/queries/smartRentals';
import RentalDetailView from './RentalDetailView';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';
import { ExitIntentModal } from '@/components/engagement/ExitIntentModal';

export const revalidate = 60;

export default async function RentalDetailPage({
  params,
}: {
  params: Promise<{ category: string; slug: string }>;
}) {
  const { category, slug } = await params;

  if (category === 'crew-services') {
    redirect('/studio');
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
      <ExitIntentModal
        prompt={`I'm interested in renting the ${rental.title}. Can you help me with availability and pricing?`}
        heading="Need help with this rental?"
        body="Get instant answers about availability, pricing, and compatible accessories from our AI assistant."
        ctaLabel="Ask about this gear"
      />
    </>
  );
}
