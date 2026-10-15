import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { MAIN_NAVIGATION } from '@/lib/constants';
import { filterNavForFlags, footerSectionsForFlags } from '@/lib/nav';
import { NotFoundMessage, notFoundMetadata } from '@/components/layout/NotFoundMessage';

export const metadata = notFoundMetadata;

/**
 * A missing page keeps the site around it (header, menu, footer), so nobody
 * is left on a blank screen with one way out.
 */
export default async function NotFound() {
  const navigation = await filterNavForFlags(MAIN_NAVIGATION);
  const footerSections = await footerSectionsForFlags();
  return (
    <div className="flex flex-col min-h-screen bg-[#0A0A0B] text-white">
      <Header navigation={navigation} />
      <main id="main" tabIndex={-1} className="flex-grow outline-none">
        <NotFoundMessage />
      </main>
      <Footer sections={footerSections} />
    </div>
  );
}
