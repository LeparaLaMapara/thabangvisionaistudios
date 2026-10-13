import { getRentalCategoryCounts } from '@/lib/supabase/queries/smartRentals';
import SmartRentalsClient from './SmartRentalsClient';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';

export const revalidate = 60;

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
