import type { Metadata } from 'next';
import { Inter, Space_Grotesk, Space_Mono } from 'next/font/google';
import './globals.css';

import { Providers } from '@/components/layout/Providers';
import { STUDIO } from '@/lib/constants';

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

export const metadata: Metadata = {
  title: {
    default:  `${STUDIO.shortName.toUpperCase()} | Technology Creative Studio`,
    template: `%s | ${STUDIO.shortName.toUpperCase()}`,
  },
  description: STUDIO.meta.description,
  metadataBase: new URL(STUDIO.meta.url),
};

/**
 * Root layout — intentionally minimal.
 *
 * Only sets up the HTML/body shell, font CSS variables, and the ThemeProvider
 * (next-themes needs to wrap everything so dark mode works in admin too).
 *
 * All chrome (Header, Footer, admin topbar) lives in the per-group layouts:
 *   app/(marketing)/layout.tsx  ← Header + Footer for public pages
 *   app/(platform)/layout.tsx   ← Header + Footer for capability pages
 *   app/(admin)/layout.tsx      ← Admin topbar only, no public nav
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: next-themes sets the theme class on <html>
    // after SSR which would otherwise trigger a React hydration mismatch.
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={[
          inter.variable,
          spaceGrotesk.variable,
          spaceMono.variable,
          'font-sans antialiased',
        ].join(' ')}
        suppressHydrationWarning
      >
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
