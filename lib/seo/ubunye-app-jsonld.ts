import { STUDIO, UBUNYE_STUDIO, type UbunyeStudioApp } from '@/lib/constants';
import { describeFile, type UbunyeRelease } from '@/lib/ubunye-release';
import { softwareApplicationJsonLd } from '@/lib/seo/structured-data';

/**
 * SoftwareApplication JSON-LD for one Ubunye app. Version, date and download
 * links come only from the published latest.json (fetched with the page's
 * revalidate); without a release they are left out, never guessed.
 */
export function ubunyeAppJsonLd(app: UbunyeStudioApp, release: UbunyeRelease | null): Record<string, unknown> {
  const desktop = UBUNYE_STUDIO.platforms.filter((p) => p.id !== 'browser').map((p) => p.label);
  const downloadUrls = release
    ? release.files.filter((f) => describeFile(f.name).platform !== null).map((f) => f.url)
    : [];
  return softwareApplicationJsonLd({
    name: app.name,
    description: `${app.category}. ${app.tagline} ${app.capabilities.join('. ')}.`,
    url: `${STUDIO.meta.url}/tools/${app.slug}`,
    applicationCategory: 'MultimediaApplication',
    applicationSubCategory: app.category,
    // Desktop builds exist only once a release is published; the browser
    // version is always there.
    operatingSystems: release ? [...desktop, 'Web browser'] : ['Web browser'],
    image: `${STUDIO.meta.url}${app.iconPng}`,
    license: UBUNYE_STUDIO.licence,
    author: UBUNYE_STUDIO.maker,
    codeRepository: app.repoUrl,
    webUrl: app.webUrl,
    release: release ? { version: release.version, published: release.published, downloadUrls } : null,
  });
}
