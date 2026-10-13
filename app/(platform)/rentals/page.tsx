import { fetchAllPublishedRentals } from '@/lib/supabase/queries/smartRentals';
import AllGearClient from './AllGearClient';
import { ALL, CATEGORIES } from '@/lib/rental/rentals-view';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { STUDIO } from '@/lib/constants';
import { collectionPointWithCity } from '@/lib/rental/collection-point';

export const revalidate = 60;

export const metadata = buildPageMetadata({
  title: 'Camera, Lighting and Audio Gear Hire',
  description: `Hire cameras, lenses, lights, audio and grip by the day from ${STUDIO.name}. Collect at ${collectionPointWithCity()} or have it delivered in ${STUDIO.serviceArea.province}. Book and pay online.`,
  path: '/rentals',
});

export default async function SmartRentalsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  // All the gear on one page; "Categories" swaps the grid for category tiles.
  const [{ rentals, failed }, { view }] = await Promise.all([fetchAllPublishedRentals(), searchParams]);
  return (
    <>
      <AllGearClient rentals={rentals} loadFailed={failed} initialCategory={view === CATEGORIES ? CATEGORIES : ALL} />
      <AskUbunyeButton prompt="Help me find the right equipment for my shoot" label="Need gear advice?" />
    </>
  );
}
