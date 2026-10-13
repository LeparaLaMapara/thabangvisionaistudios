import { notFound, permanentRedirect } from 'next/navigation';
import { getRentalBySlug } from '@/lib/supabase/queries/smartRentals';

interface Props {
  params: Promise<{ slug: string }>;
}

/**
 * /catalog/<slug> showed the same item as /rentals/<category>/<slug>: two
 * addresses for one page. The rental address is the real one, so this one
 * redirects there for good (308). CatalogDetailClient stays in the folder
 * unused until someone decides to delete it.
 */
export default async function CatalogDetailPage({ params }: Props): Promise<never> {
  const { slug } = await params;
  const rental = await getRentalBySlug(slug);

  if (!rental || !rental.category) notFound();

  permanentRedirect(`/rentals/${encodeURIComponent(rental.category)}/${encodeURIComponent(rental.slug)}`);
}
