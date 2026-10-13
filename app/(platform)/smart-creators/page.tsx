import { getPublishedCreatorProfiles } from '@/lib/supabase/queries/smartProductions';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';
import SmartCreatorsClient from './SmartCreatorsClient';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { STUDIO } from '@/lib/constants';

export const revalidate = 60;

export const metadata = buildPageMetadata({
  title: 'Creators for Hire',
  description: `Browse ID-checked photographers, filmmakers and content creators you can book through ${STUDIO.shortName} in ${STUDIO.serviceArea.province}.`,
  path: '/smart-creators',
});

export default async function SmartCreatorsPage() {
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
