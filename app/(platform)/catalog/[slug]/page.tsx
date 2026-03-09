export const revalidate = 60;

import { notFound } from 'next/navigation';
import { getRentalBySlug } from '@/lib/supabase/queries/smartRentals';
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
