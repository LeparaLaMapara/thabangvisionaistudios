import { describe, it, expect } from 'vitest';
import {
  mapScenesToSkills,
  normalizeSceneType,
  SCENE_TO_SKILL_MAP,
} from '@/lib/ubunye/skill-taxonomy';

describe('normalizeSceneType', () => {
  it('lowercases and trims recognised scenes', () => {
    expect(normalizeSceneType('Wedding')).toBe('wedding');
    expect(normalizeSceneType('  portrait ')).toBe('portrait');
  });

  it('falls back to "other" for unknown scene types', () => {
    expect(normalizeSceneType('birthday')).toBe('other');
    expect(normalizeSceneType('')).toBe('other');
  });
});

describe('mapScenesToSkills', () => {
  it('returns empty array when no scenes provided', () => {
    expect(mapScenesToSkills([])).toEqual([]);
  });

  it('maps wedding scenes to wedding_photography and event_photography with full weight', () => {
    const result = mapScenesToSkills([{ sceneType: 'wedding' }]);
    const ids = result.map((s) => s.id);
    expect(ids).toContain('wedding_photography');
    expect(ids).toContain('event_photography');
    const wedding = result.find((s) => s.id === 'wedding_photography');
    expect(wedding?.percentage).toBe(100);
  });

  it('ranks skills by prevalence across a mixed portfolio', () => {
    const scenes = [
      { sceneType: 'wedding' },
      { sceneType: 'wedding' },
      { sceneType: 'wedding' },
      { sceneType: 'portrait' },
    ];
    const result = mapScenesToSkills(scenes);
    expect(result[0].id).toBe('wedding_photography');
    expect(result[0].percentage).toBeGreaterThan(result[result.length - 1].percentage);
    const portrait = result.find((s) => s.id === 'portrait_photography');
    expect(portrait?.percentage).toBe(25);
  });

  it('maps corporate scenes to both corporate_photography and commercial_photography', () => {
    const result = mapScenesToSkills([{ sceneType: 'corporate' }]);
    const ids = result.map((s) => s.id);
    expect(ids).toContain('corporate_photography');
    expect(ids).toContain('commercial_photography');
  });

  it('ignores "other" scene types (no skill mapping)', () => {
    const result = mapScenesToSkills([{ sceneType: 'other' }, { sceneType: 'other' }]);
    expect(result).toEqual([]);
  });

  it('has a mapping entry for every defined scene type', () => {
    const scenes: Array<keyof typeof SCENE_TO_SKILL_MAP> = [
      'wedding',
      'portrait',
      'corporate',
      'product',
      'event',
      'landscape',
      'fashion',
      'food',
      'real_estate',
      'other',
    ];
    for (const scene of scenes) {
      expect(SCENE_TO_SKILL_MAP[scene]).toBeDefined();
    }
  });
});
