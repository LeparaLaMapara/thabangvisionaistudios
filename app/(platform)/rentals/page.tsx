import { fetchAllPublishedRentals } from '@/lib/supabase/queries/smartRentals';
import AllGearClient from './AllGearClient';
import { ALL, CATEGORIES } from '@/lib/rental/rentals-view';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';

export const revalidate = 60;

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
