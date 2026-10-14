export const revalidate = 60;

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { RESEARCH_LAB, STUDIO, UBUNYE_STUDIO } from '@/lib/constants';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { breadcrumbJsonLd, renderJsonLd } from '@/lib/seo/structured-data';
import { ubunyeAppJsonLd } from '@/lib/seo/ubunye-app-jsonld';
import { getUbunyeRelease, primaryInstallers } from '@/lib/ubunye-release';
import { UbunyeLoopVideo } from '@/components/tools/UbunyeLoopVideo';
import { UbunyeAppButtons, UbunyeHeroButtons, type UbunyeAppLinks } from '@/components/tools/UbunyeGetButtons';
import { UB_DISPLAY, UB_LABEL } from '@/components/tools/ubunye-styles';

export const metadata = buildPageMetadata({
  title: `${UBUNYE_STUDIO.suiteName}: Light, Photo and Film`,
  description: `${UBUNYE_STUDIO.hero.title} ${UBUNYE_STUDIO.apps
    .map((a) => `${a.name}: ${a.plain}`)
    .join(' ')} ${UBUNYE_STUDIO.hero.subtitle}`,
  path: '/tools',
  markdown: true,
});

/**
 * Ubunye Apps ("Apps" in the main nav). Data: UBUNYE_STUDIO in lib/constants.ts.
 * The top answers what it is, where it runs and what it costs; then one
 * section per app with a short loop of the real app. Distinct from /studio
 * (the productions portfolio) and /resources/tools (the on-set calculators).
 */
export default async function ToolsPage() {
  const { apps } = UBUNYE_STUDIO;
  // Same fetch the app pages make (cached for an hour); a missing latest.json
  // just leaves that app's Download out, never a made-up link.
  const releases = await Promise.all(apps.map((a) => getUbunyeRelease(a.slug)));
  const links: UbunyeAppLinks[] = apps.map((a, i) => ({
    slug: a.slug,
    name: a.name,
    accent: a.accent,
    iconPng: a.iconPng,
    webUrl: a.webUrl,
    installers: primaryInstallers(releases[i]),
  }));
  const status = UBUNYE_STUDIO.statusLabels[UBUNYE_STUDIO.status];
  const jsonLd = breadcrumbJsonLd([
    { name: 'Home', url: STUDIO.meta.url },
    { name: UBUNYE_STUDIO.suiteName, url: `${STUDIO.meta.url}/tools` },
  ]);

  return (
    <div className="pb-20 pt-28 sm:pt-32">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: renderJsonLd(jsonLd) }} />
      {apps.map((a, i) => (
        <script
          key={a.slug}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: renderJsonLd(ubunyeAppJsonLd(a, releases[i])) }}
        />
      ))}

      {/* ── Hero: what it is, where it runs, what it costs ─────────── */}
      <header className="container mx-auto px-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <p className={`${UB_LABEL} text-[var(--ub-text-2)]`}>{UBUNYE_STUDIO.suiteName}</p>
          <h1 className={`${UB_DISPLAY} mt-5 text-[2.5rem] leading-[1.08] text-[var(--ub-text)] sm:text-6xl md:text-7xl`}>
            {UBUNYE_STUDIO.hero.title}
          </h1>
          <p className="mt-5 max-w-2xl font-sans text-lg leading-relaxed text-[var(--ub-text-2)] sm:text-xl">
            {UBUNYE_STUDIO.hero.subtitle}
          </p>
          <div className="mt-8 w-full">
            <UbunyeHeroButtons apps={links} />
          </div>
        </div>
      </header>

      {/* ── One section per app ─────────────────────────────────────── */}
      <div className="container mx-auto mt-16 space-y-20 px-4 sm:mt-24 sm:space-y-28 sm:px-6">
        {apps.map((app, i) => (
          <section
            key={app.slug}
            id={app.slug}
            aria-labelledby={`${app.slug}-name`}
            className="mx-auto grid max-w-6xl scroll-mt-28 grid-cols-1 items-center gap-8 lg:grid-cols-[1.35fr_1fr] lg:gap-14"
          >
            <div className={i % 2 === 1 ? 'lg:order-2' : undefined}>
              <UbunyeLoopVideo media={app.media} label={app.name} />
            </div>
            <div>
              <p className={`${UB_LABEL} text-[var(--ub-text-2)]`}>
                {app.category} · {status}
              </p>
              <h2 id={`${app.slug}-name`} className={`${UB_DISPLAY} mt-3 text-4xl leading-tight sm:text-5xl`}>
                {UBUNYE_STUDIO.shortName} <span style={{ color: app.accent }}>{app.shortName}</span>
              </h2>
              <p className="mt-4 font-sans text-lg leading-relaxed text-[var(--ub-text)]">{app.plain}</p>
              <p className="mt-2 font-sans text-base text-[var(--ub-text-2)]">{app.audience}</p>
              <div className="mt-6">
                <UbunyeAppButtons app={links[i]} />
              </div>
              <Link
                href={`/tools/${app.slug}`}
                className="mt-4 inline-flex min-h-[44px] items-center gap-1 font-sans text-sm text-[var(--ub-text-2)] transition-colors hover:text-[var(--ub-text)]"
              >
                More about {app.name}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </section>
        ))}
      </div>

      {/* ── Closing ─────────────────────────────────────────────────── */}
      <div className="container mx-auto mt-20 px-4 sm:mt-28 sm:px-6">
        <p className="mx-auto max-w-2xl border-t border-white/10 pt-10 text-center font-sans text-base leading-relaxed text-[var(--ub-text-2)]">
          <a
            href={RESEARCH_LAB.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-white/30 underline-offset-4 transition-colors hover:text-[var(--ub-text)] hover:decoration-white/60"
          >
            {UBUNYE_STUDIO.closing}
          </a>
        </p>
      </div>
    </div>
  );
}
