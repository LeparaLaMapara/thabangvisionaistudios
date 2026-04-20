import { Header } from '@/components/layout/Header';
import { MAIN_NAVIGATION } from '@/lib/constants';
import { filterNavForFlags } from '@/lib/nav';

/**
 * Immersive layout — Header only, no Footer.
 * Used for full-viewport experiences like Ubunye AI Studio.
 */
export default async function ImmersiveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const navigation = await filterNavForFlags(MAIN_NAVIGATION);
  return (
    <div className="flex flex-col min-h-screen bg-[#030305] text-white">
      <Header navigation={navigation} />
      <main className="flex-grow">
        {children}
      </main>
    </div>
  );
}
