export const revalidate = 60;

import { getPublishedProductions } from '@/lib/supabase/queries/smartProductions';
import { getFeaturedRentals } from '@/lib/supabase/queries/smartRentals';
import SmartProductionClient from './SmartProductionClient';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';

export const metadata = {
  title: 'Smart Productions',
};

/**
 * Server Component — fetches published productions and featured rentals from
 * Supabase and passes them to the client component that handles filtering,
 * division sections, gear cross-sell, and animations.
 */
export default async function SmartProductionPage() {
  const [productions, featuredRentals] = await Promise.all([
    getPublishedProductions(),
    getFeaturedRentals(6),
  ]);
  return (
    <>
      <SmartProductionClient
        productions={productions}
        featuredRentals={featuredRentals}
      />
      <AskUbunyeButton prompt="I need a quote for a production" label="Get an instant AI quote" />
    </>
  );
}
