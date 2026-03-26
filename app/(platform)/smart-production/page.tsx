export const revalidate = 60;

import SmartProductionClient from './SmartProductionClient';
import { AskUbunyeButton } from '@/components/ubunye/AskUbunyeButton';

export const metadata = {
  title: 'Smart Productions — Photography & Video Production Services',
};

export default function SmartProductionPage() {
  return (
    <>
      <SmartProductionClient />
      <AskUbunyeButton prompt="I need a quote for a production" label="Get an instant AI quote" />
    </>
  );
}
