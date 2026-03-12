import { getPublishedRentals } from '@/lib/supabase/queries/smartRentals';
import SmartRentalsClient from './SmartRentalsClient';

export const revalidate = 60;

export default async function SmartRentalsPage() {
  const rentals = await getPublishedRentals();
  return <SmartRentalsClient rentals={rentals} />;
}
