import { getRentalCategoryCounts } from '@/lib/supabase/queries/smartRentals';
import SmartRentalsClient from './SmartRentalsClient';
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

export default async function SmartRentalsPage() {
  // Only the per-category counts: this page used to load every rental, with
  // its whole gallery, just to count them.
  const { counts, failed } = await getRentalCategoryCounts();
  return (
    <>
      <SmartRentalsClient categories={counts} loadFailed={failed} />
      <AskUbunyeButton prompt="Help me find the right equipment for my shoot" label="Need gear advice?" />
    </>
  );
}
