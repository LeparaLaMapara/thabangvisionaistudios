import { getAvailableCrewWithPortfolio } from '@/lib/supabase/queries/crew';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';
import SmartCreatorsClient from './SmartCreatorsClient';

export const revalidate = 60;

export const metadata = {
  title: 'Smart Creators',
  description:
    'Browse verified South African filmmakers, photographers, and content creators available for hire.',
};

export default async function SmartCreatorsPage() {
  const creators = await getAvailableCrewWithPortfolio();
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
