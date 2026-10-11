/**
 * Ubunye Creative Studio releases: reads <app>/latest.json from downloads.thabangvision.com
 * (written by ubunye-creative-studio-tools/web-host/publish_release.py) and sorts the files
 * by platform. Every link shown comes from a manifest that exists; no URL is made up here.
 */

export const UBUNYE_DOWNLOADS_BASE = 'https://downloads.thabangvision.com';

export interface UbunyeReleaseFile {
  name: string;
  url: string;
  size: number;
  sha256: string;
}

export interface UbunyeRelease {
  app: string;
  version: string;
  published: string;
  files: UbunyeReleaseFile[];
}

export type UbunyePlatformId = 'windows' | 'macos' | 'linux';

export interface UbunyeDownload {
  file: UbunyeReleaseFile;
  label: string;
}

export interface UbunyePlatformDownloads {
  primary: UbunyeDownload | null;
  others: UbunyeDownload[];
}

function isFile(f: unknown): f is UbunyeReleaseFile {
  if (!f || typeof f !== 'object') return false;
  const o = f as Record<string, unknown>;
  return (
    typeof o.name === 'string' &&
    typeof o.url === 'string' &&
    o.url.startsWith(`${UBUNYE_DOWNLOADS_BASE}/`) &&
    typeof o.size === 'number' &&
    typeof o.sha256 === 'string'
  );
}

/** Validates a parsed latest.json; returns null for anything malformed. */
export function parseUbunyeRelease(data: unknown, slug: string): UbunyeRelease | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  if (o.app !== slug || typeof o.version !== 'string' || typeof o.published !== 'string') return null;
  if (!Array.isArray(o.files)) return null;
  const files = o.files.filter(isFile);
  if (files.length === 0) return null;
  return { app: slug, version: o.version, published: o.published, files };
}

export async function getUbunyeRelease(slug: string): Promise<UbunyeRelease | null> {
  try {
    const res = await fetch(`${UBUNYE_DOWNLOADS_BASE}/${slug}/latest.json`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    return parseUbunyeRelease(await res.json(), slug);
  } catch {
    return null;
  }
}

const ARCH: Record<string, string> = { x64: 'x64', x86_64: 'x64', x86: '32-bit', arm64: 'ARM', aarch64: 'ARM' };

/** Describes a file by its name, e.g. "...-windows-x64.msi" -> windows, "Installer (.msi), x64". */
export function describeFile(name: string): { platform: UbunyePlatformId | null; label: string; rank: number } {
  const cli = name.includes('-cli-');
  const m = name.match(/-(windows|macos|linux|freebsd)-([a-z0-9_]+)(-portable)?\.(msi|zip|dmg|AppImage|deb|rpm|flatpak|tar\.gz)$/);
  if (!m || name.endsWith('.zsync')) return { platform: null, label: name, rank: 99 };
  const [, os, arch, portable, ext] = m;
  const a = ARCH[arch] ?? (arch === 'universal' ? 'Apple silicon and Intel' : arch);
  const kind: Record<string, string> = {
    msi: 'Installer (.msi)',
    zip: portable ? 'Portable (.zip)' : 'Command line (.zip)',
    dmg: 'Disk image (.dmg)',
    AppImage: 'AppImage',
    deb: 'Debian, Ubuntu (.deb)',
    rpm: 'Fedora, openSUSE (.rpm)',
    flatpak: 'Flatpak',
    'tar.gz': 'Archive (.tar.gz)',
  };
  const label = `${cli ? 'Command line tool' : kind[ext]}, ${a}`;
  if (os === 'freebsd') return { platform: null, label, rank: 99 };
  // Lower rank = shown first; rank 0 is the main button.
  const order: Record<string, number> = { msi: 0, dmg: 0, AppImage: 0, deb: 1, rpm: 2, flatpak: 3, zip: 4, 'tar.gz': 5 };
  const archPenalty = arch === 'x64' || arch === 'x86_64' || arch === 'universal' ? 0 : 10;
  return { platform: os as UbunyePlatformId, label, rank: (cli ? 50 : order[ext]) + archPenalty };
}

export function groupDownloads(release: UbunyeRelease): Record<UbunyePlatformId, UbunyePlatformDownloads> {
  const out: Record<UbunyePlatformId, UbunyePlatformDownloads> = {
    windows: { primary: null, others: [] },
    macos: { primary: null, others: [] },
    linux: { primary: null, others: [] },
  };
  const described = release.files
    .map((file) => ({ file, ...describeFile(file.name) }))
    .filter((d) => d.platform !== null)
    .sort((a, b) => a.rank - b.rank || a.file.name.localeCompare(b.file.name));
  for (const d of described) {
    const slot = out[d.platform as UbunyePlatformId];
    const item = { file: d.file, label: d.label };
    if (!slot.primary && d.rank === 0) slot.primary = item;
    else slot.others.push(item);
  }
  return out;
}

export function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1048576)} MB`;
}
