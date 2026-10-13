import { describe, it, expect } from 'vitest';
import { buildBioWriterPrompt, type BioWriterInput } from '@/lib/agents/agents/bio-writer';

const baseInput: BioWriterInput = {
  displayName: 'Thabang Mokoena',
  location: 'Johannesburg',
  yearsExperience: 5,
  topSceneTypes: [
    { name: 'wedding', percentage: 55 },
    { name: 'portrait', percentage: 30 },
    { name: 'event', percentage: 15 },
  ],
  detectedGear: ['Sony A7 IV', 'Canon R5'],
  topDescriptions: [
    'Golden-hour couple portrait on Cape Town beach',
    'Natural-light wedding ceremony',
    'Studio fashion shoot with rim lighting',
  ],
};

describe('buildBioWriterPrompt', () => {
  it('includes the location but never the creator name (POPIA: not needed for the bio)', () => {
    const prompt = buildBioWriterPrompt(baseInput);
    expect(prompt).toContain('Johannesburg');
    expect(prompt).not.toContain('Thabang Mokoena');
    expect(prompt).not.toMatch(/Name:/);
  });

  it('lists the top three scene types with percentages', () => {
    const prompt = buildBioWriterPrompt(baseInput);
    expect(prompt).toContain('wedding (55%)');
    expect(prompt).toContain('portrait (30%)');
    expect(prompt).toContain('event (15%)');
  });

  it('enforces first-person, SA English, no hashtags, no emojis, and a character cap', () => {
    const prompt = buildBioWriterPrompt(baseInput);
    expect(prompt).toMatch(/first person/i);
    expect(prompt).toMatch(/South African English/i);
    expect(prompt).toMatch(/280 characters/);
    expect(prompt).toMatch(/hashtags/i);
    expect(prompt).toMatch(/emojis/i);
  });

  it('gracefully handles missing optional fields', () => {
    const prompt = buildBioWriterPrompt({
      displayName: null,
      location: null,
      yearsExperience: null,
      topSceneTypes: [],
      detectedGear: [],
      topDescriptions: [],
    });
    expect(prompt).toContain('South Africa');
    expect(prompt).toContain('unspecified');
    expect(prompt).toContain('none yet');
    expect(prompt).toContain('No portfolio samples yet');
  });

  it('instructs the model to return only the bio text', () => {
    const prompt = buildBioWriterPrompt(baseInput);
    expect(prompt).toMatch(/only the bio text/i);
  });
});
