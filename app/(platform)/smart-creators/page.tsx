import { getPublishedCreatorProfiles } from '@/lib/supabase/queries/smartProductions';
import { permanentRedirect } from 'next/navigation';
import { getFlag } from '@/lib/features';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';
import SmartCreatorsClient from './SmartCreatorsClient';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { STUDIO } from '@/lib/constants';

export const revalidate = 60;

export const metadata = buildPageMetadata({
  title: 'People to book',
  description: `Browse ID-checked photographers, filmmakers and content creators you can book through ${STUDIO.shortName} in ${STUDIO.serviceArea.province}.`,
  path: '/smart-creators',
});

export default async function SmartCreatorsPage() {
  // roles_v1: everyone bookable lives on People; this address keeps old links working (308).
  if (await getFlag('roles_v1')) permanentRedirect('/people');
  const creators = await getPublishedCreatorProfiles();
  return (
    <>
      <SmartCreatorsClient creators={creators} />
      <AskUbunyeButton
        prompt="Help me find the right creator for my project"
        label="Need a creator?"
      />
    </>
  );
}
