import Link from 'next/link';
import type { Metadata } from 'next';
import { getFlag } from '@/lib/features';
import { PLAN } from '@/lib/constants';

/** The tab title for every "not found" page. */
export const notFoundMetadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: true },
};

const linkClass =
  'min-h-[44px] inline-flex items-center justify-center text-xs font-mono uppercase tracking-widest border border-neutral-800 px-6 py-3 hover:bg-white hover:text-black transition-colors duration-300';

/**
 * What a missing page says (clarity audit POLISH 2): a plain heading and the
 * four places people usually want. People goes to /people with roles_v1 on,
 * else to the list of people to book.
 */
export async function NotFoundMessage() {
  const rolesOn = await getFlag('roles_v1');
  const links = [
    { label: 'Rentals', href: '/rentals' },
    { label: 'People', href: rolesOn ? '/people' : '/smart-creators' },
    { label: PLAN.cta, href: PLAN.href },
    { label: 'Home', href: '/' },
  ];
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-40 px-6 text-center">
      <h1 className="text-3xl md:text-5xl font-display font-medium text-white">We couldn&apos;t find that page</h1>
      <p className="text-neutral-400 max-w-md">The link may be old, or the page has moved. Try one of these:</p>
      <nav aria-label="Where to go next">
        <ul className="flex flex-wrap justify-center gap-3">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className={linkClass}>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
