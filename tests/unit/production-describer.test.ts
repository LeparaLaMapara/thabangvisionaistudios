import { describe, it, expect } from 'vitest';
import {
  buildVisionPrompt,
  buildDescriptionPrompt,
  parseVisionOutput,
  parseDescriptionOutput,
} from '@/lib/agents/agents/production-describer';

describe('production-describer', () => {
  describe('buildVisionPrompt', () => {
    it('returns a prompt requesting JSON with scene analysis fields', () => {
      const prompt = buildVisionPrompt();
      expect(prompt).toContain('sceneType');
      expect(prompt).toContain('mood');
      expect(prompt).toContain('subjects');
      expect(prompt).toContain('JSON');
    });
  });

  describe('buildDescriptionPrompt', () => {
    it('includes production details and vision analysis', () => {
      const prompt = buildDescriptionPrompt(
        { title: 'Wedding Film', projectType: 'wedding', imageUrl: 'https://example.com/img.jpg', year: 2026 },
        { sceneType: 'wedding', mood: 'intimate', subjects: 'bride and groom', style: 'cinematic', lighting: 'golden_hour', setting: 'outdoor' },
      );
      expect(prompt).toContain('Wedding Film');
      expect(prompt).toContain('wedding');
      expect(prompt).toContain('intimate');
      expect(prompt).toContain('bride and groom');
      expect(prompt).toContain('2026');
    });
  });

  describe('parseVisionOutput', () => {
    it('parses valid JSON', () => {
      const result = parseVisionOutput(JSON.stringify({
        sceneType: 'wedding',
        mood: 'intimate',
        subjects: 'couple on beach',
        style: 'cinematic',
        lighting: 'golden_hour',
        setting: 'outdoor',
      }));
      expect(result.sceneType).toBe('wedding');
      expect(result.mood).toBe('intimate');
      expect(result.subjects).toBe('couple on beach');
    });

    it('returns fallback for invalid input', () => {
      const result = parseVisionOutput('no json here');
      expect(result.sceneType).toBe('other');
      expect(result.mood).toBe('cinematic');
    });

    it('handles JSON wrapped in prose', () => {
      const result = parseVisionOutput('Here is the analysis:\n{"sceneType":"concert","mood":"energetic","subjects":"band on stage","style":"candid","lighting":"neon","setting":"indoor"}\nDone.');
      expect(result.sceneType).toBe('concert');
      expect(result.setting).toBe('indoor');
    });
  });

  describe('parseDescriptionOutput', () => {
    it('parses valid JSON with description and tags', () => {
      const result = parseDescriptionOutput(JSON.stringify({
        description: 'A cinematic wedding film.',
        tags: ['Wedding', 'cinematic', 'Golden-Hour'],
      }));
      expect(result.description).toBe('A cinematic wedding film.');
      expect(result.tags).toEqual(['wedding', 'cinematic', 'golden-hour']);
    });

    it('lowercases and trims tags', () => {
      const result = parseDescriptionOutput('{"description":"Test","tags":["  TAG ","Another "]}');
      expect(result.tags).toEqual(['tag', 'another']);
    });

    it('throws on missing JSON', () => {
      expect(() => parseDescriptionOutput('no json')).toThrow();
    });

    it('handles missing arrays gracefully', () => {
      const result = parseDescriptionOutput('{"description":"Test"}');
      expect(result.tags).toEqual([]);
    });
  });
});
