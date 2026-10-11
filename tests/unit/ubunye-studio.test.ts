import { describe, it, expect } from 'vitest';
import { UBUNYE_STUDIO, getUbunyeApp, MAIN_NAVIGATION } from '@/lib/constants';
import { FEATURE_KEYS, type FeatureKey } from '@/lib/features';
import { filterNavSync } from '@/lib/nav';

describe('UBUNYE_STUDIO', () => {
  it('lists light, photo and film in that order', () => {
    expect(UBUNYE_STUDIO.apps.map((a) => a.slug)).toEqual(['light', 'photo', 'film']);
  });

  it('finds an app by slug and rejects unknown slugs', () => {
    expect(getUbunyeApp('film')?.name).toBe('Ubunye Film');
    expect(getUbunyeApp('studio')).toBeUndefined();
  });

  it('publishes no download URL before the first release', () => {
    expect(UBUNYE_STUDIO.status).toBe('coming-soon');
    expect(UBUNYE_STUDIO.downloads.manifestUrl).toBeNull();
  });

  it('every app has a browser version on its own tools.thabangvision.com host', () => {
    for (const app of UBUNYE_STUDIO.apps) {
      expect(app.webUrl).toBe(`https://${app.slug}.tools.thabangvision.com`);
    }
  });

  it('every app has an icon, source repo, upstream credit and no card photo yet', () => {
    for (const app of UBUNYE_STUDIO.apps) {
      expect(app.icon).toMatch(/^\/ubunye\/.+\.svg$/);
      expect(app.repoUrl).toMatch(/^https:\/\/github\.com\/ubunye-ai-ecosystems\//);
      expect(app.upstream.url).toMatch(/^https:\/\/github\.com\/storytold\//);
      expect(app.image).toBeNull();
    }
  });
});

describe('Tools nav entry', () => {
  const allOn = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as Record<FeatureKey, boolean>;

  it('is in MAIN_NAVIGATION', () => {
    expect(MAIN_NAVIGATION.some((i) => i.href === '/tools')).toBe(true);
  });

  it('is hidden while creative_tools is off and shown when on', () => {
    const off = { ...allOn, creative_tools: false };
    expect(filterNavSync(MAIN_NAVIGATION, off).some((i) => i.href === '/tools')).toBe(false);
    expect(filterNavSync(MAIN_NAVIGATION, allOn).some((i) => i.href === '/tools')).toBe(true);
  });
});
