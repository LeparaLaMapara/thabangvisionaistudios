import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';

/**
 * Marketing layout — wraps all public-facing pages:
 *   /  /lab  /contact  /careers  /locations  /press
 *   /privacy  /support/tech  /login  /legal
 *
 * Renders the public Header and Footer.
 * Admin routes in (admin)/ never enter this layout.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen bg-neutral-50 dark:bg-[#0A0A0B] text-neutral-900 dark:text-white selection:bg-black selection:text-white dark:selection:bg-white dark:selection:text-black transition-colors duration-500">
      <Header />
      <main className="flex-grow">
        {children}
      </main>
      <Footer />
    </div>
  );
}
