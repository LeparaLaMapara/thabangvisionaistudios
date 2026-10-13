import { fetchAllPublishedRentals } from '@/lib/supabase/queries/smartRentals';
import AllGearClient from './AllGearClient';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';

export const revalidate = 60;

export default async function SmartRentalsPage() {
  // All the gear on one page; categories are a filter on it, not a door.
  const { rentals, failed } = await fetchAllPublishedRentals();
  return (
    <>
      <AllGearClient rentals={rentals} loadFailed={failed} />
      <AskUbunyeButton prompt="Help me find the right equipment for my shoot" label="Need gear advice?" />
    </>
  );
}
