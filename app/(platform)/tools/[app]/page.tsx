export const revalidate = 60;

import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowDown, ArrowLeft, ArrowUpRight, Check } from 'lucide-react';
import { STUDIO, UBUNYE_STUDIO, getUbunyeApp } from '@/lib/constants';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { formatSize, getUbunyeRelease, groupDownloads, type UbunyePlatformId } from '@/lib/ubunye-release';
import { breadcrumbJsonLd, renderJsonLd } from '@/lib/seo/structured-data';
import { UB_DISPLAY, UB_LABEL, withAlpha } from '@/components/tools/ubunye-styles';

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
    description: `${app.name}, ${app.tagline} A free, open source ${app.category.toLowerCase()} app from ${UBUNYE_STUDIO.suiteName}. ${availability}`,
    path: `/tools/${app.slug}`,
  });
}

export default async function ToolPage({ params }: ToolPageProps) {
  const { app: slug } = await params;
  const app = getUbunyeApp(slug);
  if (!app) notFound();

  const release = await getUbunyeRelease(app.slug);
  const downloads = release ? groupDownloads(release) : null;
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
              {UBUNYE_STUDIO.version} · {statusLabel} · Free and open source
            </p>
            <div className="mt-6">
              <a
                href={app.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-full px-6 font-sans text-xs font-semibold uppercase tracking-[0.2em] text-[var(--ub-bg)] transition-opacity hover:opacity-90"
                style={{ backgroundColor: app.accent }}
              >
                Open in browser
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          </div>
        </header>

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

          {/* ── Download ────────────────────────────────────────────── */}
          <section className="rounded-[22px] border border-white/10 bg-[var(--ub-bg-2)] p-6 sm:p-8">
            <h2 className={`${UB_LABEL} text-[var(--ub-text-2)]`}>Download</h2>
            <p className="mt-3 font-sans text-sm text-[var(--ub-text-2)]">
              {release
                ? `Version ${release.version}, a preview build. The apps are not code signed yet, so Windows and macOS will warn that the developer is unknown.`
                : 'The browser version is live. Desktop downloads will appear here when the first release is out.'}
            </p>
            <table className="mt-6 w-full font-sans text-sm">
              <caption className="sr-only">{`${app.name} downloads by platform`}</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Platform</th>
                  <th scope="col">Download</th>
                </tr>
              </thead>
              {UBUNYE_STUDIO.platforms.map((p) => {
                const d = p.id === 'browser' || !downloads ? null : downloads[p.id as UbunyePlatformId];
                return (
                  <tbody key={p.id} className="border-t border-white/10 first:border-t-0">
                    <tr>
                      <th scope="row" className="py-3 pr-4 text-left font-normal text-[var(--ub-text)]">
                        {p.label}
                        {p.note && <span className="ml-2 text-xs text-[var(--ub-text-2)]">({p.note})</span>}
                        {d?.primary && (
                          <span className="block text-xs text-[var(--ub-text-2)]">
                            {d.primary.label}, {formatSize(d.primary.file.size)}
                          </span>
                        )}
                      </th>
                      <td className="py-3 text-right">
                        {p.id === 'browser' ? (
                          <a
                            href={app.webUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-[44px] min-w-[132px] items-center justify-center gap-1.5 rounded-full border px-5 text-xs uppercase tracking-[0.2em] text-[var(--ub-text)] transition-colors hover:bg-white/5"
                            style={{ borderColor: app.accent }}
                          >
                            Open
                            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                          </a>
                        ) : d?.primary ? (
                          <a
                            href={d.primary.file.url}
                            download
                            className="inline-flex min-h-[44px] min-w-[132px] items-center justify-center gap-1.5 rounded-full border px-5 text-xs uppercase tracking-[0.2em] text-[var(--ub-text)] transition-colors hover:bg-white/5"
                            style={{ borderColor: app.accent }}
                          >
                            Download
                            <ArrowDown className="h-4 w-4" aria-hidden="true" />
                          </a>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className="inline-flex min-h-[44px] min-w-[132px] cursor-not-allowed items-center justify-center rounded-full border border-white/15 px-5 text-xs uppercase tracking-[0.2em] text-[var(--ub-text-2)]"
                          >
                            {statusLabels['coming-soon']}
                          </button>
                        )}
                      </td>
                    </tr>
                    {d && d.others.length > 0 && (
                      <tr>
                        <td colSpan={2} className="pb-3">
                          <details className="group">
                            <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-xs text-[var(--ub-text-2)] hover:text-[var(--ub-text)]">
                              Other {p.label} downloads ({d.others.length})
                            </summary>
                            <ul className="mt-1 space-y-1">
                              {d.others.map((o) => (
                                <li key={o.file.name}>
                                  <a
                                    href={o.file.url}
                                    download
                                    className="inline-flex min-h-[44px] items-center gap-2 text-sm text-[var(--ub-text)] underline decoration-white/30 underline-offset-4 hover:decoration-white"
                                  >
                                    {o.label}
                                    <span className="text-xs text-[var(--ub-text-2)]">{formatSize(o.file.size)}</span>
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </details>
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
            </table>
          </section>

          {/* ── System requirements ─────────────────────────────────── */}
          <section className="rounded-[22px] border border-white/10 bg-[var(--ub-bg-2)] p-6 sm:p-8">
            <h2 className={`${UB_LABEL} text-[var(--ub-text-2)]`}>System requirements</h2>
            <p className="mt-6 font-sans text-base text-[var(--ub-text)]">{UBUNYE_STUDIO.systemRequirements}</p>
          </section>

          {/* ── Licence and credits ─────────────────────────────────── */}
          <section className="rounded-[22px] border border-white/10 bg-[var(--ub-bg-2)] p-6 sm:p-8">
            <h2 className={`${UB_LABEL} text-[var(--ub-text-2)]`}>Licence and credits</h2>
            <p className="mt-6 font-sans text-base text-[var(--ub-text)]">
              {app.name} is free and open source, licensed {UBUNYE_STUDIO.licence}. Made by {UBUNYE_STUDIO.maker}.
            </p>
            <p className="mt-3 font-sans text-sm text-[var(--ub-text-2)]">{app.upstream.credit}.</p>
            <ul className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-6">
              <li>
                <a
                  href={app.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center gap-1.5 font-sans text-sm text-[var(--ub-text)] underline decoration-white/30 underline-offset-4 hover:decoration-white"
                >
                  {app.name} source code
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </a>
              </li>
              <li>
                <a
                  href={app.upstream.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center gap-1.5 font-sans text-sm text-[var(--ub-text)] underline decoration-white/30 underline-offset-4 hover:decoration-white"
                >
                  {app.upstream.name} (upstream)
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </a>
              </li>
            </ul>
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
