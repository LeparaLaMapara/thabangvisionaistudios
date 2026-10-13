import { describe, expect, it } from 'vitest';
import { analysesForUploaded, analysisUnavailable, manualSkillChoices, skillChoices } from '@/lib/onboarding/skill-choices';
import { CREATOR_SPECIALIZATIONS } from '@/lib/constants';

// Found by the local journey tests: with the vision model unreachable every
// photo came back "Analysis unavailable" (qualityScore 0), the portfolio step
// offered no way on, and a creator could only skip onboarding entirely.
const failed = { sceneType: 'other', lightingSetup: 'unknown', qualityScore: 0, description: 'Analysis failed for this image.', hashtags: [] };
const good = { ...failed, sceneType: 'wedding', qualityScore: 8 };
const photo = (analysis: typeof failed | null, extra: Record<string, unknown> = {}) => ({ url: 'https://res.cloudinary.com/x/a.jpg', uploading: false, error: null, analysis, ...extra });

describe('analysisUnavailable', () => {
  it('is true once every uploaded photo was analysed and fewer than two are usable', () => {
    expect(analysisUnavailable([photo(failed), photo(failed)], false)).toBe(true);
    expect(analysisUnavailable([photo(good), photo(failed)], false)).toBe(true);
  });

  it('is false while analysing, uploading, before analysis, or when the AI worked', () => {
    expect(analysisUnavailable([photo(failed), photo(failed)], true)).toBe(false);
    expect(analysisUnavailable([photo(failed), photo(null, { uploading: true, url: null })], false)).toBe(false);
    expect(analysisUnavailable([photo(null), photo(null)], false)).toBe(false);
    expect(analysisUnavailable([photo(good), photo(good)], false)).toBe(false);
    expect(analysisUnavailable([photo(failed)], false)).toBe(false);
  });

  it('carries the uploaded photos on, keeping tags the creator corrected', () => {
    const corrected = { ...failed, sceneType: 'portrait' };
    expect(analysesForUploaded([photo(failed), photo(corrected), photo(null, { error: 'too big' })]).map((a) => a.sceneType)).toEqual(['other', 'portrait']);
  });
});

describe('skillChoices', () => {
  it('offers detected platform skills, ticked', () => {
    const r = skillChoices({ skills: [{ name: 'Wedding', percentage: 100 }], platformSkills: [{ id: 'wedding_photography', label: 'Wedding Photography', percentage: 100 }] });
    expect(r.manual).toBe(false);
    expect(r.skills).toEqual([{ id: 'wedding_photography', name: 'Wedding Photography', percentage: 100, selected: true }]);
  });

  it('falls back to the platform vocabulary, unticked, when nothing was detected', () => {
    for (const result of [null, { skills: [{ name: 'Other', percentage: 100 }], platformSkills: [] }, { skills: [] }]) {
      const r = skillChoices(result);
      expect(r.manual).toBe(true);
      expect(r.skills.map((s) => s.id)).toEqual(CREATOR_SPECIALIZATIONS.map((s) => s.value));
      expect(r.skills.every((s) => !s.selected)).toBe(true);
    }
    expect(manualSkillChoices()[0].name).toBe(CREATOR_SPECIALIZATIONS[0].label);
  });
});

// Codex review on PR #63.
describe('when the analysis request itself fails, or only one photo was usable', () => {
  it('a failed request (no photo got a result) lets the creator go on', () => {
    expect(analysisUnavailable([photo(null), photo(null)], false, true)).toBe(true);
    expect(analysisUnavailable([photo(null), photo(null)], true, true)).toBe(false);
  });

  it('going on without a usable analysis offers the whole list, with detected skills ticked', () => {
    const first = CREATOR_SPECIALIZATIONS[0].value;
    const result = { platformSkills: [{ id: first, label: 'x', percentage: 100 }] } as never;
    const r = skillChoices(result, true);
    expect(r.manual).toBe(true);
    expect(r.skills).toHaveLength(CREATOR_SPECIALIZATIONS.length);
    expect(r.skills.filter((s) => s.selected).map((s) => s.id)).toEqual([first]);
  });
});
