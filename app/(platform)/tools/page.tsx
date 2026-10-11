export const revalidate = 60;

import Image from 'next/image';
import Link from 'next/link';
import { STUDIO, UBUNYE_STUDIO } from '@/lib/constants';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { breadcrumbJsonLd, renderJsonLd } from '@/lib/seo/structured-data';
import { UbunyeAppCard } from '@/components/tools/UbunyeAppCard';
import { UB_DISPLAY, UB_LABEL } from '@/components/tools/ubunye-styles';

export const metadata = buildPageMetadata({
  title: `${UBUNYE_STUDIO.suiteName}: Light, Photo and Film`,
  description: `${UBUNYE_STUDIO.suiteName} is a free, open source suite of three creative tools: ${UBUNYE_STUDIO.apps
    .map((a) => `${a.name} for ${a.category.toLowerCase()}`)
    .join(', ')}. ${UBUNYE_STUDIO.statusLabels[UBUNYE_STUDIO.status]} for ${UBUNYE_STUDIO.platforms
    .filter((p) => p.note === null)
    .map((p) => p.label)
    .join(', ')}; try each one in your browser now.`,
  path: '/tools',
});

/**
 * Ubunye Creative Studio catalogue. Data: UBUNYE_STUDIO in lib/constants.ts.
 * Distinct from /studio (the productions portfolio) and /resources/tools
 * (the on-set calculators).
 */
export default function ToolsPage() {
  const { apps } = UBUNYE_STUDIO;
  const jsonLd = breadcrumbJsonLd([
    { name: 'Home', url: STUDIO.meta.url },
    { name: UBUNYE_STUDIO.suiteName, url: `${STUDIO.meta.url}/tools` },
  ]);

  return (
    <div className="pb-20 pt-28 sm:pt-32">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: renderJsonLd(jsonLd) }} />

      {/* ── Masthead ───────────────────────────────────────────────── */}
      <header className="container mx-auto px-4 sm:px-6">
        <div className="relative flex flex-col items-center text-center">
          <h1 className="w-full max-w-[640px]">
            <Image
              src={UBUNYE_STUDIO.wordmark}
              alt={UBUNYE_STUDIO.suiteName}
              width={1200}
              height={420}
              unoptimized
              priority
              className="h-auto w-full"
            />
          </h1>
          <p className={`${UB_LABEL} mt-6 max-w-md leading-loose text-[var(--ub-text-2)]`}>
            {UBUNYE_STUDIO.intro}
          </p>
        </div>
      </header>

      {/* ── The three apps ─────────────────────────────────────────── */}
      <section aria-label="Apps" className="container mx-auto mt-12 px-4 sm:mt-16 sm:px-6">
        <ul className="mx-auto grid max-w-md grid-cols-1 gap-5 lg:max-w-none lg:grid-cols-3 lg:gap-6">
          {apps.map((app, i) => (
            <li key={app.slug}>
              <UbunyeAppCard
                app={app}
                suiteShortName={UBUNYE_STUDIO.shortName}
                statusLabel={`${UBUNYE_STUDIO.version} · Try in browser`}
                index={i}
              />
            </li>
          ))}
        </ul>
      </section>

      {/* ── Footer strip: icon family, line, palette ───────────────── */}
      <section
        aria-label={`About ${UBUNYE_STUDIO.suiteName}`}
        className="container mx-auto mt-14 px-4 sm:mt-20 sm:px-6"
      >
        <div className="grid grid-cols-1 items-center gap-10 border-t border-white/10 pt-10 lg:grid-cols-[1fr_auto_1fr_auto_1.3fr] lg:gap-8">
          <div>
            <p className={`${UB_LABEL} text-[var(--ub-text-2)]`}>Icon family</p>
            <div className="mt-5 flex gap-4">
              {apps.map((app) => (
                <Link
                  key={app.slug}
                  href={`/tools/${app.slug}`}
                  className="block rounded-[14px] transition-transform hover:scale-105"
                  aria-label={app.name}
                >
                  <Image src={app.iconPng} alt="" width={64} height={64} unoptimized className="h-16 w-16" />
                </Link>
              ))}
            </div>
          </div>

          <span className="hidden h-20 w-px bg-white/10 lg:block" aria-hidden="true" />

          <p className={`${UB_DISPLAY} max-w-sm text-2xl leading-snug text-[var(--ub-text)]`}>
            {UBUNYE_STUDIO.footerLine}
          </p>

          <span className="hidden h-20 w-px bg-white/10 lg:block" aria-hidden="true" />

          <div>
            <p className={`${UB_LABEL} text-[var(--ub-text-2)]`}>Colour palette</p>
            <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {apps.map((app) => (
                <li key={app.slug} className="flex items-center gap-3">
                  <span
                    className="h-10 w-10 shrink-0 rounded-full"
                    style={{ backgroundColor: app.accent }}
                    aria-hidden="true"
                  />
                  <span className="flex flex-col">
                    <span className="font-sans text-[10px] uppercase tracking-[0.24em] text-[var(--ub-text)]">
                      {app.name}
                    </span>
                    <span className="font-sans text-[10px] uppercase tracking-[0.24em] text-[var(--ub-text-2)]">
                      {app.accent}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mt-12 text-center font-sans text-sm text-[var(--ub-text-2)]">
          Free and open source ({UBUNYE_STUDIO.licence}), made by {UBUNYE_STUDIO.maker}. No downloads yet:
          the first release is on its way.
        </p>
      </section>
    </div>
  );
}
