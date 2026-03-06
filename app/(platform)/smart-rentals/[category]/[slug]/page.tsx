import { notFound } from 'next/navigation';
import { getRentalBySlug } from '@/lib/supabase/queries/smartRentals';
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

  return <RentalDetailView rental={rental} category={category} />;
}
