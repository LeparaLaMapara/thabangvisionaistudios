export const revalidate = 60;

import { getPublishedProductions } from '@/lib/supabase/queries/smartProductions';
import SmartProductionClient from './SmartProductionClient';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';

export const metadata = {
  title: 'Smart Productions — Photography & Film Production',
};

export default async function SmartProductionPage() {
  const productions = await getPublishedProductions();
  return (
    <>
      <SmartProductionClient productions={productions} />
      <AskUbunyeButton prompt="I need a quote for a production" label="Get an instant AI quote" />
    </>
  );
}
