import type { Metadata } from 'next';
import { Inter, Space_Grotesk, Space_Mono, Orbitron } from 'next/font/google';
import './globals.css';

import { Analytics } from '@vercel/analytics/next';
import { Providers } from '@/components/layout/Providers';
import { STUDIO, SITE_TAGLINE } from '@/lib/constants';
import { createClient } from '@/lib/supabase/server';
import { organizationJsonLd, localBusinessJsonLd, renderJsonLd } from '@/lib/seo/structured-data';
import { getRentalPriceRange, type RentalPriceRange } from '@/lib/supabase/queries/smartRentals';

// ── Google Fonts via next/font ──
// CSS variables injected into <html>, consumed by @theme in globals.css.
// Loaded once here so every route group (marketing, platform, admin) shares them.
const inter = Inter({
  subsets:  ['latin'],
  variable: '--font-inter',
  display:  'swap',
});

const spaceGrotesk = Space_Grotesk({
  subsets:  ['latin'],
  variable: '--font-space-grotesk',
  display:  'swap',
});

// Original Google Fonts: Space+Mono:ital,wght@0,400;0,700;1,400
const spaceMono = Space_Mono({
  subsets:  ['latin'],
  weight:   ['400', '700'],
  style:    ['normal', 'italic'],
  variable: '--font-space-mono',
  display:  'swap',
});

const orbitron = Orbitron({
  subsets:  ['latin'],
  weight:   ['400', '500', '600', '700', '800', '900'],
  variable: '--font-orbitron',
  display:  'swap',
});

export const metadata: Metadata = {
  title: {
    default:  `${STUDIO.shortName} | ${SITE_TAGLINE}`,
    template: `%s | ${STUDIO.shortName.toUpperCase()}`,
  },
  description: STUDIO.meta.description,
  metadataBase: new URL(STUDIO.meta.url),
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/logo-favicon-32.png', type: 'image/png', sizes: '32x32' },
    ],
    apple: [
      { url: '/logo-favicon-180.png', sizes: '180x180' },
    ],
  },
  openGraph: {
    type: 'website',
    url: STUDIO.meta.url,
    siteName: STUDIO.shortName,
    locale: 'en_ZA',
    images: [{ url: '/logo-black-bg.png', alt: STUDIO.shortName, width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${STUDIO.shortName} | ${SITE_TAGLINE}`,
    description: STUDIO.meta.description,
    images: ['/logo-black-bg.png'],
  },
  alternates: {
    types: {
      'application/rss+xml': `${STUDIO.meta.url}/feed.xml`,
    },
    languages: {
      'en-ZA': STUDIO.meta.url,
    },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large' as const,
      'max-snippet': -1,
    },
  },
};

/**
 * Root layout — intentionally minimal.
 *
 * Only sets up the HTML/body shell, font CSS variables, and providers.
 * Dark mode is hardcoded via className="dark" on <html>.
 *
 * All chrome (Header, Footer, admin topbar) lives in the per-group layouts:
 *   app/(marketing)/layout.tsx  ← Header + Footer for public pages
 *   app/(platform)/layout.tsx   ← Header + Footer for capability pages
 *   app/(admin)/layout.tsx      ← Admin topbar only, no public nav
 */
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Get user on the server to prevent auth flicker on client
  let initialUser: { id: string; email?: string } | null = null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      initialUser = { id: user.id, email: user.email ?? undefined };
    }
  } catch {
    // No session — user is null
  }

  // Feeds the LocalBusiness priceRange from live stock instead of a hardcoded
  // band. Never let a failure here take the whole layout down: the field is
  // optional in the JSON-LD, so a null just omits it.
  let priceRange: RentalPriceRange | null = null;
  try {
    priceRange = await getRentalPriceRange();
  } catch {
    // Leave priceRange out of the structured data
  }

  return (
    <html lang="en" className="dark">
      <body
        className={[
          inter.variable,
          spaceGrotesk.variable,
          spaceMono.variable,
          orbitron.variable,
          'font-sans antialiased',
        ].join(' ')}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: renderJsonLd(organizationJsonLd()) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: renderJsonLd(localBusinessJsonLd(priceRange)) }}
        />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:bg-[#D4A843] focus:text-[#050505] focus:px-4 focus:py-3 focus:text-sm focus:font-bold"
        >
          Skip to content
        </a>
        <Providers initialUser={initialUser}>
          {children}
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
