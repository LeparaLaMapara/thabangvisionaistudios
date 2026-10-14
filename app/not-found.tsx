import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { MAIN_NAVIGATION } from '@/lib/constants';
import { filterNavForFlags, footerSectionsForFlags } from '@/lib/nav';

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
      <main id="main" tabIndex={-1} className="flex-grow outline-none flex flex-col items-center justify-center gap-6 py-40 px-6">
        <p className="text-neutral-400 uppercase tracking-widest text-sm font-mono">
          404 — Page Not Found
        </p>
        <Link
          href="/"
          className="min-h-[44px] inline-flex items-center text-xs font-mono uppercase tracking-widest border border-neutral-800 px-6 py-3 hover:bg-white hover:text-black transition-colors duration-300"
        >
          Return Home
        </Link>
      </main>
      <Footer sections={footerSections} />
    </div>
  );
}
