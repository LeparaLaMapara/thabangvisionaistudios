import { getPublishedRentals } from '@/lib/supabase/queries/smartRentals';
import SmartRentalsClient from './SmartRentalsClient';

export const dynamic = 'force-dynamic';

export default async function SmartRentalsPage() {
  const rentals = await getPublishedRentals();
  console.log('DB RENTALS COUNT:', rentals.length);
  return <SmartRentalsClient rentals={rentals} />;
}
