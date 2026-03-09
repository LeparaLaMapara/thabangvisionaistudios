import { describe, it, expect } from 'vitest';
import {
  STUDIO,
  SITE_NAME,
  MAIN_NAVIGATION,
  FOOTER_SECTIONS,
} from '@/lib/constants';

describe('STUDIO config object', () => {
  it('has a non-empty name', () => {
    expect(STUDIO.name).toBeTruthy();
    expect(STUDIO.name.length).toBeGreaterThan(0);
  });

  it('has a non-empty shortName', () => {
    expect(STUDIO.shortName).toBeTruthy();
  });

  it('has a valid email address', () => {
    expect(STUDIO.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });

  it('has a non-empty meta.url', () => {
    expect(STUDIO.meta.url).toBeTruthy();
    expect(STUDIO.meta.url).toMatch(/^https?:\/\//);
  });

  it('has a non-empty meta.title', () => {
    expect(STUDIO.meta.title).toBeTruthy();
  });

  it('has a non-empty meta.description', () => {
    expect(STUDIO.meta.description).toBeTruthy();
    expect(STUDIO.meta.description.length).toBeGreaterThan(10);
  });

  it('has a valid currency code', () => {
    expect(STUDIO.currency.code).toBe('ZAR');
    expect(STUDIO.currency.symbol).toBe('R');
    expect(STUDIO.currency.locale).toBe('en-ZA');
  });

  it('has location with city and country', () => {
    expect(STUDIO.location.city).toBeTruthy();
    expect(STUDIO.location.country).toBe('South Africa');
  });

  it('has lat/lng coordinates', () => {
    expect(typeof STUDIO.location.lat).toBe('number');
    expect(typeof STUDIO.location.lng).toBe('number');
  });

  it('has at least one location in the locations array', () => {
    expect(STUDIO.locations.length).toBeGreaterThanOrEqual(1);
    const primary = STUDIO.locations.find((l) => l.isPrimary);
    expect(primary).toBeDefined();
  });

  it('has rental config with valid numbers', () => {
    expect(STUDIO.rental.depositPercent).toBeGreaterThan(0);
    expect(STUDIO.rental.depositPercent).toBeLessThanOrEqual(100);
    expect(STUDIO.rental.maxBookingDays).toBeGreaterThan(0);
    expect(STUDIO.rental.cancellationHours).toBeGreaterThan(0);
  });

  it('has nav sections with hrefs', () => {
    expect(STUDIO.nav.sections.length).toBeGreaterThan(0);
    for (const section of STUDIO.nav.sections) {
      expect(section.href).toMatch(/^\//);
      expect(section.label).toBeTruthy();
    }
  });
});

describe('SITE_NAME', () => {
  it('is uppercase', () => {
    expect(SITE_NAME).toBe(SITE_NAME.toUpperCase());
  });

  it('derives from STUDIO.shortName', () => {
    expect(SITE_NAME).toBe(STUDIO.shortName.toUpperCase());
  });
});

describe('MAIN_NAVIGATION', () => {
  it('has at least 3 items', () => {
    expect(MAIN_NAVIGATION.length).toBeGreaterThanOrEqual(3);
  });

  it('every item has a label and href', () => {
    for (const item of MAIN_NAVIGATION) {
      expect(item.label).toBeTruthy();
      expect(item.href).toMatch(/^\//);
    }
  });
});

describe('FOOTER_SECTIONS', () => {
  it('has at least 2 sections', () => {
    expect(FOOTER_SECTIONS.length).toBeGreaterThanOrEqual(2);
  });

  it('every section has a title and links', () => {
    for (const section of FOOTER_SECTIONS) {
      expect(section.title).toBeTruthy();
      expect(section.links.length).toBeGreaterThan(0);
      for (const link of section.links) {
        expect(link.label).toBeTruthy();
        expect(link.href).toMatch(/^\//);
      }
    }
  });
});
