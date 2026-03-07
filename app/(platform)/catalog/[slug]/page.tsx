import { notFound } from 'next/navigation';
import { getRentalBySlug, getPublishedRentals } from '@/lib/supabase/queries/smartRentals';
import CatalogDetailClient from './CatalogDetailClient';

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function CatalogDetailPage({ params }: Props) {
  const { slug } = await params;
  const rental = await getRentalBySlug(slug);

  if (!rental) {
    notFound();
  }

  return <CatalogDetailClient rental={rental} />;
}

export async function generateStaticParams() {
  const rentals = await getPublishedRentals();
  return rentals.map((r) => ({ slug: r.slug }));
}
