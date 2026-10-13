export const revalidate = 60;

import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Check } from 'lucide-react';
import { STUDIO, UBUNYE_STUDIO, getUbunyeApp } from '@/lib/constants';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { getUbunyeRelease, pickerFiles } from '@/lib/ubunye-release';
import { breadcrumbJsonLd, renderJsonLd } from '@/lib/seo/structured-data';
import { UB_DISPLAY, UB_LABEL, withAlpha } from '@/components/tools/ubunye-styles';
import { UbunyeDownloadPicker } from '@/components/tools/UbunyeDownloadPicker';

interface ToolPageProps {
  params: Promise<{ app: string }>;
}

export async function generateMetadata({ params }: ToolPageProps) {
  const { app: slug } = await params;
  const app = getUbunyeApp(slug);
  if (!app) return { title: UBUNYE_STUDIO.suiteName };

  const release = await getUbunyeRelease(app.slug);
  const availability = release
    ? 'Free download for Windows, macOS and Linux, or try it in your browser.'
    : 'Try it in your browser.';
  return buildPageMetadata({
    title: `${app.name}: ${app.category}`,
    description: `${app.name}: ${app.category}. ${app.tagline} Free, from ${UBUNYE_STUDIO.suiteName}. ${availability}`,
    path: `/tools/${app.slug}`,
  });
}

export default async function ToolPage({ params }: ToolPageProps) {
  const { app: slug } = await params;
  const app = getUbunyeApp(slug);
  if (!app) notFound();

  const release = await getUbunyeRelease(app.slug);
  const files = release ? pickerFiles(release) : null;
  const statusLabels = UBUNYE_STUDIO.statusLabels;
  const statusLabel = release ? statusLabels.preview : statusLabels[UBUNYE_STUDIO.status];
  const others = UBUNYE_STUDIO.apps.filter((a) => a.slug !== app.slug);
  const jsonLd = breadcrumbJsonLd([
    { name: 'Home', url: STUDIO.meta.url },
    { name: UBUNYE_STUDIO.suiteName, url: `${STUDIO.meta.url}/tools` },
    { name: app.name, url: `${STUDIO.meta.url}/tools/${app.slug}` },
  ]);

  const heroGlow = {
    backgroundImage: `radial-gradient(60% 55% at 50% 0%, ${withAlpha(app.accent, '2e')} 0%, transparent 70%)`,
  };

  return (
    <div className="pb-20 pt-28 sm:pt-32">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: renderJsonLd(jsonLd) }} />

      <div className="container mx-auto px-4 sm:px-6">
        <Link
          href="/tools"
          className={`${UB_LABEL} inline-flex min-h-[44px] items-center gap-2 text-[var(--ub-text-2)] transition-colors hover:text-[var(--ub-text)]`}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All tools
        </Link>

        {/* ── App switcher ─────────────────────────────────────────── */}
        <nav aria-label={`${UBUNYE_STUDIO.suiteName} apps`} className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
          {UBUNYE_STUDIO.apps.map((a) => {
            const current = a.slug === app.slug;
            return (
              <Link
                key={a.slug}
                href={`/tools/${a.slug}`}
                aria-current={current ? 'page' : undefined}
                className={`flex min-h-[44px] flex-col items-center gap-2 rounded-[18px] border px-2 pb-3 pt-3 transition-colors ${
                  current ? 'border-white/25 bg-white/[0.06]' : 'border-white/10 hover:border-white/25'
                }`}
              >
                <Image src={a.iconPng} alt="" width={48} height={48} unoptimized className="h-10 w-10 sm:h-12 sm:w-12" />
                <span className="text-center font-sans text-xs text-[var(--ub-text)] sm:text-sm">{a.name}</span>
                <span
                  className="h-[3px] w-10 rounded-full"
                  style={{ backgroundColor: current ? a.accent : 'rgba(255,255,255,0.12)' }}
                  aria-hidden="true"
                />
              </Link>
            );
          })}
        </nav>

        {/* ── Hero ─────────────────────────────────────────────────── */}
        <header
          className="mt-6 grid grid-cols-1 items-center gap-10 rounded-[22px] border border-white/10 px-6 py-10 sm:px-10 md:grid-cols-[auto_1fr] md:gap-14 md:py-14"
          style={heroGlow}
        >
          <Image
            src={app.icon}
            alt={`${app.name} icon`}
            width={240}
            height={240}
            unoptimized
            priority
            className="mx-auto h-40 w-40 sm:h-52 sm:w-52 md:h-60 md:w-60"
            style={{ filter: `drop-shadow(0 0 36px ${withAlpha(app.accent, '59')})` }}
          />
          <div className="text-center md:text-left">
            <p className={`${UB_LABEL} text-[var(--ub-text-2)]`}>
              {UBUNYE_STUDIO.suiteName}
            </p>
            <h1 className={`${UB_DISPLAY} mt-4 text-5xl leading-tight sm:text-6xl`}>
              {UBUNYE_STUDIO.shortName} <span style={{ color: app.accent }}>{app.shortName}</span>
            </h1>
            <span
              className="mx-auto mt-5 block h-[2px] w-10 rounded-full md:mx-0"
              style={{ backgroundColor: app.accent }}
              aria-hidden="true"
            />
            <p className={`${UB_LABEL} mt-6 text-[var(--ub-text)]`}>{app.category}</p>
            <p className={`${UB_DISPLAY} mt-3 text-xl text-[var(--ub-text-2)] sm:text-2xl`}>{app.tagline}</p>
            <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-4 py-2 font-sans text-xs text-[var(--ub-text-2)]">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: app.accent }} aria-hidden="true" />
              {release ? `Version ${release.version}` : UBUNYE_STUDIO.version} · {statusLabel} · Free
            </p>
          </div>
        </header>

        {/* ── Download ────────────────────────────────────────────── */}
        <section
          aria-labelledby="download-heading"
          className="mx-auto mt-6 max-w-2xl rounded-[22px] border border-white/10 bg-[var(--ub-bg-2)] p-6 sm:p-8"
        >
          <h2 id="download-heading" className={`${UB_LABEL} text-[var(--ub-text-2)]`}>
            Get {app.name}
          </h2>
          <div className="mt-6">
            <UbunyeDownloadPicker
              appName={app.name}
              accent={app.accent}
              webUrl={app.webUrl}
              version={release?.version ?? null}
              files={files}
            />
          </div>
        </section>

        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* ── What it does ────────────────────────────────────────── */}
          <section className="rounded-[22px] border border-white/10 bg-[var(--ub-bg-2)] p-6 sm:p-8">
            <h2 className={`${UB_LABEL} text-[var(--ub-text-2)]`}>What it does</h2>
            <ul className="mt-6 space-y-4">
              {app.capabilities.map((c) => (
                <li key={c} className="flex items-start gap-3 font-sans text-base text-[var(--ub-text)]">
                  <Check className="mt-1 h-4 w-4 shrink-0" style={{ color: app.accent }} aria-hidden="true" />
                  {c}
                </li>
              ))}
            </ul>
          </section>


          {/* ── System requirements ─────────────────────────────────── */}
          <section className="rounded-[22px] border border-white/10 bg-[var(--ub-bg-2)] p-6 sm:p-8">
            <h2 className={`${UB_LABEL} text-[var(--ub-text-2)]`}>System requirements</h2>
            <p className="mt-6 font-sans text-base text-[var(--ub-text)]">{UBUNYE_STUDIO.systemRequirements}</p>
          </section>
        </div>

        {/* ── The rest of the suite ──────────────────────────────────── */}
        <section aria-label="Other tools" className="mt-14 border-t border-white/10 pt-10">
          <h2 className={`${UB_LABEL} text-[var(--ub-text-2)]`}>Also in {UBUNYE_STUDIO.suiteName}</h2>
          <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {others.map((o) => (
              <li key={o.slug}>
                <Link
                  href={`/tools/${o.slug}`}
                  className="flex min-h-[44px] items-center gap-4 rounded-[18px] border border-white/10 bg-[var(--ub-bg-2)] p-4 transition-colors hover:border-white/25"
                >
                  <Image src={o.iconPng} alt="" width={56} height={56} unoptimized className="h-14 w-14" />
                  <span className="flex flex-col">
                    <span className={`${UB_DISPLAY} text-2xl`}>
                      {UBUNYE_STUDIO.shortName} <span style={{ color: o.accent }}>{o.shortName}</span>
                    </span>
                    <span className="font-sans text-[10px] uppercase tracking-[0.32em] text-[var(--ub-text-2)]">
                      {o.category}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
