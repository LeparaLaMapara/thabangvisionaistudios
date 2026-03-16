import { getPublishedRentals } from '@/lib/supabase/queries/smartRentals';
import SmartRentalsClient from './SmartRentalsClient';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';

export const revalidate = 60;

export default async function SmartRentalsPage() {
  const rentals = await getPublishedRentals();
  return (
    <>
      <SmartRentalsClient rentals={rentals} />
      <AskUbunyeButton prompt="Help me find the right equipment for my shoot" label="Need gear advice?" />
    </>
  );
}
