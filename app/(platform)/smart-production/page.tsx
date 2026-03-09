export const revalidate = 60;

import { getPublishedProductions } from '@/lib/supabase/queries/smartProductions';
import SmartProductionClient from './SmartProductionClient';

export const metadata = {
  title: 'Smart Productions',
};

/**
 * Server Component — fetches published productions from Supabase and passes
 * them to the client component that handles filtering + animations.
 * No data.ts usage; no client-side DB calls.
 */
export default async function SmartProductionPage() {
  const productions = await getPublishedProductions();
  return <SmartProductionClient productions={productions} />;
}
