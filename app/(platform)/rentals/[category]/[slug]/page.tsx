import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getRentalBySlug, getRelatedRentals, getRentalOwner } from '@/lib/supabase/queries/smartRentals';
import RentalDetailView from './RentalDetailView';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';
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

  // Same call as generateMetadata; getRentalBySlug is cache()-wrapped, so this
  // reuses that result instead of querying again.
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
      {/* No exit-intent modal here: this page is the start of a booking, and a
          pop-up on the way to the date picker is an interruption, not help
          (spec 9.5, no unnecessary modal chains). The Ask Ubunye button above
          already offers the same route. */}
    </>
  );
}
