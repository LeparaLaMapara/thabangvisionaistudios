import { describe, it, expect } from 'vitest';
import { describeFile, formatSize, groupDownloads, parseUbunyeRelease, pickerFiles, UBUNYE_DOWNLOADS_BASE, type UbunyeRelease } from '@/lib/ubunye-release';

const B = 'https://downloads.thabangvision.com/light/0.5.0';
const file = (name: string, size = 80 * 1048576) => ({ name, url: `${B}/${name}`, size, sha256: 'ab' });

const release: UbunyeRelease = {
  app: 'light',
  version: '0.5.0',
  published: '2026-10-11T07:00:00Z',
  files: [
    file('ubunye-creative-light-0.5.0-windows-x64.msi'),
    file('ubunye-creative-light-0.5.0-windows-x86.msi'),
    file('ubunye-creative-light-0.5.0-windows-arm64.msi'),
    file('ubunye-creative-light-0.5.0-windows-x64-portable.zip'),
    file('ubunye-creative-light-0.5.0-macos-universal.dmg'),
    file('ubunye-creative-light-cli-0.5.0-macos-universal.zip'),
    file('ubunye-creative-light-0.5.0-linux-x86_64.AppImage'),
    file('ubunye-creative-light-0.5.0-linux-x86_64.AppImage.zsync', 300000),
    file('ubunye-creative-light-0.5.0-linux-x86_64.deb'),
    file('ubunye-creative-light-0.5.0-linux-aarch64.AppImage'),
    file('ubunye-creative-light-0.5.0-freebsd-x86_64.tar.gz'),
  ],
};

describe('parseUbunyeRelease', () => {
  it('accepts a well-formed manifest for the right app', () => {
    expect(parseUbunyeRelease(release, 'light')?.files).toHaveLength(11);
  });

  it('rejects a manifest for another app, or with no usable files', () => {
    expect(parseUbunyeRelease(release, 'photo')).toBeNull();
    expect(parseUbunyeRelease({ ...release, files: [] }, 'light')).toBeNull();
    expect(parseUbunyeRelease(null, 'light')).toBeNull();
  });

  it('drops files that do not live on downloads.thabangvision.com', () => {
    const bad = { ...release, files: [{ ...release.files[0], url: 'https://evil.example/x.msi' }, release.files[1]] };
    expect(parseUbunyeRelease(bad, 'light')?.files.map((f) => f.name)).toEqual([release.files[1].name]);
  });
});

describe('groupDownloads', () => {
  const g = groupDownloads(release);

  it('offers the x64 installer, the universal disk image and the x64 AppImage first', () => {
    expect(g.windows.primary?.file.name).toBe('ubunye-creative-light-0.5.0-windows-x64.msi');
    expect(g.macos.primary?.file.name).toBe('ubunye-creative-light-0.5.0-macos-universal.dmg');
    expect(g.linux.primary?.file.name).toBe('ubunye-creative-light-0.5.0-linux-x86_64.AppImage');
  });

  it('lists the rest under their platform, leaving out .zsync and FreeBSD', () => {
    const all = [...g.windows.others, ...g.macos.others, ...g.linux.others].map((d) => d.file.name);
    expect(all).toContain('ubunye-creative-light-0.5.0-windows-arm64.msi');
    expect(all).toContain('ubunye-creative-light-cli-0.5.0-macos-universal.zip');
    expect(all.some((n) => n.endsWith('.zsync') || n.includes('freebsd'))).toBe(false);
  });
});

describe('describeFile', () => {
  it('labels files in plain words', () => {
    expect(describeFile('ubunye-creative-light-0.5.0-windows-x64.msi').label).toBe('Installer (.msi), x64');
    expect(describeFile('ubunye-creative-light-0.5.0-linux-aarch64.deb').label).toBe('Debian, Ubuntu (.deb), ARM');
    expect(describeFile('ubunye-creative-light-0.5.0-macos-universal.dmg').label).toBe(
      'Disk image (.dmg), Apple silicon and Intel',
    );
  });

  it('formats sizes in MB', () => {
    expect(formatSize(80 * 1048576)).toBe('80 MB');
  });
});

describe('pickerFiles', () => {
  const file = (name: string) => ({ name, url: `${UBUNYE_DOWNLOADS_BASE}/film/0.5.0/${name}`, size: 52 * 1048576, sha256: 'x' });
  const release = {
    app: 'film',
    version: '0.5.0',
    published: '2026-10-11T07:08:22Z',
    files: [
      'ubunye-creative-film-0.5.0-windows-x64.msi',
      'ubunye-creative-film-0.5.0-windows-arm64.msi',
      'ubunye-creative-film-0.5.0-windows-x86-portable.zip',
      'ubunye-creative-film-0.5.0-macos-universal.dmg',
      'ubunye-creative-film-cli-0.5.0-macos-universal.zip',
      'ubunye-creative-film-0.5.0-linux-aarch64.AppImage',
      'ubunye-creative-film-0.5.0-linux-aarch64.AppImage.zsync',
      'ubunye-creative-film-0.5.0-freebsd-x86_64.tar.gz',
    ].map(file),
  };

  it('marks one installer per processor as main and keeps the rest as other formats', () => {
    const p = pickerFiles(release);
    expect(p.windows.filter((f) => f.main).map((f) => f.arch)).toEqual(['x64', 'arm64']);
    expect(p.windows.find((f) => !f.main)?.arch).toBe('x86');
    expect(p.linux.map((f) => [f.arch, f.main])).toEqual([['arm64', true]]);
  });

  it('never offers the command line tool as the Mac download', () => {
    const p = pickerFiles(release);
    expect(p.macos.filter((f) => f.main).map((f) => f.name)).toEqual(['ubunye-creative-film-0.5.0-macos-universal.dmg']);
    expect(p.macos.find((f) => f.name.includes('-cli-'))?.main).toBe(false);
  });
});
