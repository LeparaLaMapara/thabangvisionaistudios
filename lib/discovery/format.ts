import { STUDIO, UBUNYE_STUDIO } from '@/lib/constants';
import { formatRand } from '@/lib/format/money';
import { describeFile, groupDownloads, type UbunyePlatformId } from '@/lib/ubunye-release';
import type { CatalogCreator, CatalogRental, CatalogTool } from '@/lib/discovery/types';

/** Shared text helpers for llms.txt, llms-full.txt and the markdown twins. */

/** "R1 300" with a plain space, for machine readers. */
export function rand(amount: number): string {
  return formatRand(amount).replace(/ /g, ' ');
}

export function absUrl(path: string): string {
  return `${STUDIO.meta.url}${path === '/' ? '' : path}`;
}

/** One line of text, markdown-safe enough for a list item. */
export function oneLine(text: string | null | undefined, max = 240): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

export function rentalPriceText(r: CatalogRental): string {
  const parts: string[] = [];
  parts.push(r.pricePerDay !== null ? `${rand(r.pricePerDay)} a day` : 'price on request');
  if (r.pricePerWeek && r.pricePerWeek > 0) parts.push(`${rand(r.pricePerWeek)} a week`);
  if (r.deposit && r.deposit > 0) parts.push(`refundable deposit ${rand(r.deposit)}`);
  return parts.join(', ');
}

export function rentalLine(r: CatalogRental): string {
  const name = [r.title, r.brand && !r.title.includes(r.brand) ? `(${r.brand})` : ''].filter(Boolean).join(' ');
  return `- [${name}](${absUrl(r.path)}): ${rentalPriceText(r)}.${r.isAvailable ? '' : ' Not available right now.'}`;
}

export function creatorLine(p: CatalogCreator): string {
  const what = p.specializations.length > 0 ? p.specializations.join(', ') : 'Creator';
  const where = p.location ? `, based in ${p.location}` : '';
  const rate = p.hourlyRate !== null ? `, from ${rand(p.hourlyRate)} an hour` : '';
  return `- [${p.name}](${absUrl(p.path)}): ${what}${where}${rate}. ID checked by ${STUDIO.shortName}.`;
}

/** The main download per desktop platform, from the published release. */
export function primaryDownloads(t: CatalogTool): { platform: UbunyePlatformId; label: string; url: string }[] {
  if (!t.version || !t.published || t.files.length === 0) return [];
  const groups = groupDownloads({ app: t.slug, version: t.version, published: t.published, files: t.files });
  return (Object.keys(groups) as UbunyePlatformId[])
    .map((platform) => {
      const g = groups[platform];
      const d = g.primary ?? g.others[0];
      return d ? { platform, label: d.label, url: d.file.url } : null;
    })
    .filter((x): x is { platform: UbunyePlatformId; label: string; url: string } => x !== null);
}

const platformLabel = (id: string): string => UBUNYE_STUDIO.platforms.find((p) => p.id === id)?.label ?? id;

export function toolLines(t: CatalogTool, full = false): string[] {
  const lines = [
    `- [${t.name}](${absUrl(t.path)}): ${t.category}. ${t.tagline} Free and open source (${t.licence}).`,
    `  - Try it in the browser: ${t.webUrl}`,
    `  - Source code: ${t.repoUrl}`,
  ];
  if (t.version) lines.push(`  - Latest release: ${t.version}${t.published ? `, published ${t.published.slice(0, 10)}` : ''}`);
  if (full) {
    for (const f of t.files) {
      const d = describeFile(f.name);
      if (d.platform === null) continue;
      lines.push(`  - Download (${platformLabel(d.platform)}, ${d.label}): ${f.url} (sha256 ${f.sha256})`);
    }
  } else {
    for (const d of primaryDownloads(t)) lines.push(`  - Download for ${platformLabel(d.platform)} (${d.label}): ${d.url}`);
  }
  return lines;
}
