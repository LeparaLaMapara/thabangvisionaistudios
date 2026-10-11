export const revalidate = 60;

import Link from 'next/link';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { STUDIO, UBUNYE_STUDIO } from '@/lib/constants';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { breadcrumbJsonLd, renderJsonLd } from '@/lib/seo/structured-data';
import { UB_DISPLAY, UB_LABEL } from '@/components/tools/ubunye-styles';

export const metadata = buildPageMetadata({
  title: `Code signing policy: ${UBUNYE_STUDIO.suiteName}`,
  description: `How the Windows downloads of ${UBUNYE_STUDIO.apps.map((a) => a.name).join(', ')} are signed, who approves each release, and what the apps do with your data.`,
  path: UBUNYE_STUDIO.codeSigning.path,
});

const linkClass =
  'inline-flex min-h-[44px] items-center gap-1.5 text-[var(--ub-text)] underline decoration-white/30 underline-offset-4 hover:decoration-white';

/**
 * The code signing policy SignPath Foundation requires of the projects it signs for
 * (https://signpath.org/terms). Data: UBUNYE_STUDIO.codeSigning in lib/constants.ts.
 */
export default function CodeSigningPolicyPage() {
  const cs = UBUNYE_STUDIO.codeSigning;
  const jsonLd = breadcrumbJsonLd([
    { name: 'Home', url: STUDIO.meta.url },
    { name: UBUNYE_STUDIO.suiteName, url: `${STUDIO.meta.url}/tools` },
    { name: 'Code signing policy', url: `${STUDIO.meta.url}${cs.path}` },
  ]);

  return (
    <div className="pb-20 pt-28 sm:pt-32">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: renderJsonLd(jsonLd) }} />
      <article className="container mx-auto max-w-3xl px-4 font-sans text-base leading-relaxed text-[var(--ub-text)] sm:px-6">
        <Link
          href="/tools"
          className={`${UB_LABEL} inline-flex min-h-[44px] items-center gap-2 text-[var(--ub-text-2)] transition-colors hover:text-[var(--ub-text)]`}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All tools
        </Link>

        <p className={`${UB_LABEL} mt-8 text-[var(--ub-text-2)]`}>{UBUNYE_STUDIO.suiteName}</p>
        <h1 className={`${UB_DISPLAY} mt-3 text-4xl leading-tight sm:text-5xl`}>Code signing policy</h1>

        <p className="mt-8 rounded-2xl border border-white/10 bg-[var(--ub-bg-2)] p-5">
          {cs.attribution}{' '}
          <span className="text-[var(--ub-text-2)]">
            {cs.signing
              ? 'Windows releases are signed this way.'
              : 'We have applied to SignPath Foundation. Until the first signed release, the Windows downloads are not signed.'}
          </span>
        </p>

        <h2 className={`${UB_LABEL} mt-12 text-[var(--ub-text-2)]`}>What is signed</h2>
        <p className="mt-4">
          The Windows installers (.msi) and portable downloads (.zip) of{' '}
          {UBUNYE_STUDIO.apps.map((a, i) => (
            <span key={a.slug}>
              {i > 0 && (i === UBUNYE_STUDIO.apps.length - 1 ? ' and ' : ', ')}
              <Link href={`/tools/${a.slug}`} className={linkClass}>
                {a.name}
              </Link>
            </span>
          ))}
          . Every file is built by GitHub Actions straight from the public source code. Nothing is built or signed on
          anyone&apos;s own computer.
        </p>
        <ul className="mt-4 space-y-1">
          {UBUNYE_STUDIO.apps.map((a) => (
            <li key={a.slug}>
              <a href={a.repoUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
                {a.name} source code
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[var(--ub-text-2)]">
          Each app is a fork of an open source project by the ArtCraft team ({UBUNYE_STUDIO.apps
            .map((a) => a.upstream.name)
            .join(', ')}
          ), whose own releases are signed. We keep the full upstream history and bring their changes in through
          reviewed pull requests.
        </p>

        <h2 className={`${UB_LABEL} mt-12 text-[var(--ub-text-2)]`}>Team roles</h2>
        <dl className="mt-4 space-y-4">
          <div>
            <dt className="font-medium">Committers and reviewers</dt>
            <dd className="text-[var(--ub-text-2)]">
              <a href={cs.approver.url} target="_blank" rel="noopener noreferrer" className={linkClass}>
                {cs.approver.name} (@{cs.approver.handle})
              </a>
              , the only person with write access to the repositories. Changes from anyone else arrive as pull requests
              and are reviewed before they are merged.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Approvers</dt>
            <dd className="text-[var(--ub-text-2)]">
              <a href={cs.approver.url} target="_blank" rel="noopener noreferrer" className={linkClass}>
                {cs.approver.name} (@{cs.approver.handle})
              </a>
              . Every release is approved by hand before it is signed.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Organisation</dt>
            <dd className="text-[var(--ub-text-2)]">
              <a href={cs.orgPeopleUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
                {UBUNYE_STUDIO.maker} members
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-[var(--ub-text-2)]">
          Everyone on the team must use two-factor sign-in for GitHub and SignPath.
        </p>

        <h2 className={`${UB_LABEL} mt-12 text-[var(--ub-text-2)]`}>Privacy</h2>
        <p className="mt-4">
          The apps do not send your photos, videos or any usage data anywhere. They only connect to the internet when
          you ask them to, for example to download an optional AI model, which comes from the address shown in the app
          before you start the download. Nothing else is transferred to other networked systems unless you or the
          installer ask for it.
        </p>

        <h2 className={`${UB_LABEL} mt-12 text-[var(--ub-text-2)]`}>Checking a download</h2>
        <p className="mt-4">
          On Windows, right-click the file, choose <strong>Properties</strong>, then <strong>Digital Signatures</strong>.
          A signed file shows SignPath Foundation as the signer. Each download&apos;s SHA-256 checksum is also listed in
          the release manifest.
        </p>

        <p className="mt-12 text-sm text-[var(--ub-text-2)]">
          Code signing by{' '}
          <a href={cs.signPathUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
            SignPath.io
          </a>
          , certificate by{' '}
          <a href={cs.foundationUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
            SignPath Foundation
          </a>
          .
        </p>
      </article>
    </div>
  );
}
