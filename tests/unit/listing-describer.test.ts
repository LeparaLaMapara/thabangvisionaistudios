import { describe, it, expect } from 'vitest';
import {
  buildListingDescriberPrompt,
  parseListingDescriberOutput,
  type ListingDescriberInput,
} from '@/lib/agents/agents/listing-describer';

const baseInput: ListingDescriberInput = {
  brand: 'Sony',
  model: 'A7 IV',
  category: 'cameras-optics',
  condition: 'like_new',
  city: 'Cape Town',
};

describe('buildListingDescriberPrompt', () => {
  it('includes brand, model, category, condition and city', () => {
    const prompt = buildListingDescriberPrompt(baseInput);
    expect(prompt).toContain('Sony');
    expect(prompt).toContain('A7 IV');
    expect(prompt).toContain('cameras-optics');
    expect(prompt).toContain('like_new');
    expect(prompt).toContain('Cape Town');
  });

  it('falls back to "South Africa" when city is null', () => {
    const prompt = buildListingDescriberPrompt({ ...baseInput, city: null });
    expect(prompt).toContain('South Africa');
  });

  it('requests JSON output with the required fields', () => {
    const prompt = buildListingDescriberPrompt(baseInput);
    expect(prompt).toContain('"title"');
    expect(prompt).toContain('"description"');
    expect(prompt).toContain('"rentalIncludes"');
    expect(prompt).toContain('"suggestedUpsells"');
    expect(prompt).toMatch(/only the JSON object/i);
  });

  it('bans marketing cliches', () => {
    const prompt = buildListingDescriberPrompt(baseInput);
    expect(prompt).toMatch(/passionate/i);
    expect(prompt).toMatch(/creative eye/i);
  });
});

describe('parseListingDescriberOutput', () => {
  it('extracts JSON from clean output', () => {
    const output = parseListingDescriberOutput(JSON.stringify({
      title: 'Sony A7 IV body',
      description: 'Full-frame mirrorless body. Suits weddings and portrait shoots.',
      rentalIncludes: ['body', 'one battery', 'strap'],
      suggestedUpsells: ['extra battery', '128GB SD card'],
    }));
    expect(output.title).toBe('Sony A7 IV body');
    expect(output.rentalIncludes).toHaveLength(3);
    expect(output.suggestedUpsells).toContain('extra battery');
  });

  it('extracts JSON when wrapped in text', () => {
    const raw = 'Sure, here is the listing:\n{"title":"Test","description":"D","rentalIncludes":["a"],"suggestedUpsells":["b"]}\nThanks!';
    const output = parseListingDescriberOutput(raw);
    expect(output.title).toBe('Test');
  });

  it('gracefully handles missing array fields', () => {
    const output = parseListingDescriberOutput(JSON.stringify({
      title: 'X',
      description: 'Y',
    }));
    expect(output.rentalIncludes).toEqual([]);
    expect(output.suggestedUpsells).toEqual([]);
  });

  it('throws if no JSON is found', () => {
    expect(() => parseListingDescriberOutput('no json here')).toThrow();
  });
});
