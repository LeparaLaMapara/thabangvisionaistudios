export const revalidate = 60;

import SmartProductionClient from './SmartProductionClient';
import { STUDIO } from '@/lib/constants';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';
import { getPublishedProductions } from '@/lib/supabase/queries/smartProductions';

export const metadata = {
  title: 'Photo and Video Shoots by Request',
  description: `Photo and video shoots in ${STUDIO.serviceArea.province}, by request. ${STUDIO.serviceArea.outsideProvinceNote} Choose a package and send a request; we confirm who will shoot it, the date and the price before you pay.`,
};

/**
 * The work itself is the page.
 *
 * This used to open on six category tiles, and five of them led to an empty
 * page — every published project sat under Photography. A visitor met six
 * doors, opened one, and found nothing. Showing the work directly is both
 * honest about what exists and faster to browse at this size.
 *
 * The /studio/category/[slug] routes still work; they are just no longer the
 * way in.
 */
export default async function SmartProductionPage() {
  const productions = await getPublishedProductions();

  return (
    <>
      <SmartProductionClient productions={productions} />
      <AskUbunyeButton prompt="I need a quote for a production" label="Questions? Ask Ubunye" />
    </>
  );
}
