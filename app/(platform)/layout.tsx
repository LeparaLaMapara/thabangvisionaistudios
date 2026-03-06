import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';

/**
 * Platform layout — wraps capability pages:
 *   /smart-production  /smart-production/[slug]
 *   /smart-rentals     /smart-rentals/[category]
 *   /ubunye-ai-studio  /catalog/[slug]
 *   /resources/tools
 *
 * Renders the same public Header and Footer as the marketing layout.
 * Kept as a separate group so platform pages can gain their own
 * layout chrome independently in the future.
 */
export default function PlatformLayout({
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
