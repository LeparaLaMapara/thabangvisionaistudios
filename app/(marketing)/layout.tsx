import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { MAIN_NAVIGATION } from '@/lib/constants';
import { filterNavForFlags } from '@/lib/nav';

/**
 * Marketing layout — wraps all public-facing pages:
 *   /  /about  /contact  /careers  /locations  /press
 *   /privacy  /support/tech  /login  /legal
 *
 * Renders the public Header and Footer.
 * Admin routes in (admin)/ never enter this layout.
 */
export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const navigation = await filterNavForFlags(MAIN_NAVIGATION);
  return (
    <div className="flex flex-col min-h-screen bg-neutral-50 dark:bg-[#0A0A0B] text-neutral-900 dark:text-white selection:bg-black selection:text-white dark:selection:bg-white dark:selection:text-black transition-colors duration-500">
      <Header navigation={navigation} />
      <main id="main" tabIndex={-1} className="flex-grow outline-none">
        {children}
      </main>
      <Footer />
    </div>
  );
}
