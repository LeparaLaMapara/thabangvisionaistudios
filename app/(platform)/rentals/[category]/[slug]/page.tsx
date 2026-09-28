import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getRentalBySlug, getRelatedRentals, getRentalOwner } from '@/lib/supabase/queries/smartRentals';
import RentalDetailView from './RentalDetailView';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';
import { ExitIntentModal } from '@/components/engagement/ExitIntentModal';
import { onlinePaymentsOpen } from '@/lib/payments/status';

export const revalidate = 60;

/** The browser tab and search result name the item, not the site in general. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const rental = await getRentalBySlug(slug);
  if (!rental) return {};
  const image = rental.thumbnail_url ?? undefined;
  return {
    title: rental.title,
    description: rental.description?.slice(0, 160) ?? undefined,
    openGraph: { title: rental.title, images: image ? [image] : undefined },
  };
}

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

  const [relatedRentals, owner] = await Promise.all([
    getRelatedRentals(rental.category, rental.id, 4),
    // Studio stock passes null and short-circuits inside the query.
    getRentalOwner(rental.owner_type === 'community' ? rental.owner_id : null),
  ]);

  return (
    <>
      <RentalDetailView
        rental={rental}
        category={category}
        relatedRentals={relatedRentals}
        owner={owner}
        paymentsOpen={onlinePaymentsOpen()}
      />
      <AskUbunyeButton raised
        prompt={`Tell me more about the ${rental.title} and what it's best for`}
        label="Questions about this gear?"
      />
      <ExitIntentModal
        prompt={`I'm interested in renting the ${rental.title}. Can you help me with availability and pricing?`}
        heading="Need help with this rental?"
        body="Ask our AI assistant about availability, pricing and accessories that work with it."
        ctaLabel="Ask about this gear"
      />
    </>
  );
}
