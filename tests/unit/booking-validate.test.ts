import { describe, it, expect } from 'vitest';
import {
  validateBookingRequest,
  DELIVERABLES_PLACEHOLDER,
} from '@/lib/bookings/validate';
import { STUDIO } from '@/lib/constants';

/** Exactly what BookConfirmation posts for the booking that failed in production. */
const SCREENSHOT_PAYLOAD = {
  project_category: 'Wedding Photography',
  project_description: 'Wedding Photography booking — 1 hours',
  deliverables: '',
  duration_hours: 1,
  location: 'Braamfontein',
  preferred_dates: '2026-08-31',
};

describe('the booking that failed in production', () => {
  it('is accepted', () => {
    // R1,725 total, correct on screen, refused at the pay step with
    // "Missing required fields: project_category, project_description,
    //  deliverables, duration_hours" — none of which the customer could act on.
    const result = validateBookingRequest(SCREENSHOT_PAYLOAD);
    expect(result.ok).toBe(true);
  });

  it('fills deliverables rather than refusing', () => {
    const result = validateBookingRequest(SCREENSHOT_PAYLOAD);
    if (!result.ok) throw new Error(result.error);
    expect(result.deliverables).toBe(DELIVERABLES_PLACEHOLDER);
  });
});

describe('validateBookingRequest', () => {
  it('refuses only what a booking cannot exist without', () => {
    const result = validateBookingRequest({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('project_category');
    expect(result.error).toContain('duration_hours');
    // The two that used to be listed regardless of whether they were the problem.
    expect(result.error).not.toContain('deliverables');
    expect(result.error).not.toContain('project_description');
  });

  it('names only the field that is actually missing', () => {
    const result = validateBookingRequest({ duration_hours: 2 });
    expect(result).toEqual({ ok: false, error: 'Missing required fields: project_category' });
  });

  it('keeps a description the client actually wrote', () => {
    const written = 'Two hours of headshots for eight staff members at our Sandton office.';
    const result = validateBookingRequest({ ...SCREENSHOT_PAYLOAD, project_description: written });
    if (!result.ok) throw new Error(result.error);
    expect(result.projectDescription).toBe(written);
  });

  it('writes a usable description when the generated one is too short', () => {
    const result = validateBookingRequest({ ...SCREENSHOT_PAYLOAD, project_description: 'wedding' });
    if (!result.ok) throw new Error(result.error);
    expect(result.projectDescription).toContain('Wedding Photography');
    expect(result.projectDescription).toContain('2026-08-31');
    expect(result.projectDescription).toContain('Braamfontein');
    expect(result.projectDescription.length).toBeGreaterThanOrEqual(20);
  });

  it('says "1 hour" not "1 hours"', () => {
    const result = validateBookingRequest({ ...SCREENSHOT_PAYLOAD, project_description: '' });
    if (!result.ok) throw new Error(result.error);
    expect(result.projectDescription).toContain('1 hour ');
  });

  it('keeps deliverables when they were chosen', () => {
    const result = validateBookingRequest({ ...SCREENSHOT_PAYLOAD, deliverables: 'Photos + Video' });
    if (!result.ok) throw new Error(result.error);
    expect(result.deliverables).toBe('Photos + Video');
  });

  it('still enforces the duration bounds', () => {
    const tooLong = validateBookingRequest({
      ...SCREENSHOT_PAYLOAD, duration_hours: STUDIO.booking.maxBookingHours + 1,
    });
    expect(tooLong.ok).toBe(false);

    const atMax = validateBookingRequest({
      ...SCREENSHOT_PAYLOAD, duration_hours: STUDIO.booking.maxBookingHours,
    });
    expect(atMax.ok).toBe(true);
  });

  it('rejects a non-numeric duration rather than trusting it', () => {
    const result = validateBookingRequest({ ...SCREENSHOT_PAYLOAD, duration_hours: '6' });
    expect(result.ok).toBe(false);
  });

  it('trims whitespace rather than treating it as content', () => {
    const result = validateBookingRequest({ ...SCREENSHOT_PAYLOAD, deliverables: '   ' });
    if (!result.ok) throw new Error(result.error);
    expect(result.deliverables).toBe(DELIVERABLES_PLACEHOLDER);
  });

  it('never returns an empty deliverables string, because the column is NOT NULL', () => {
    for (const value of ['', '   ', null, undefined, 42]) {
      const result = validateBookingRequest({ ...SCREENSHOT_PAYLOAD, deliverables: value });
      if (!result.ok) throw new Error(result.error);
      expect(result.deliverables.length, String(value)).toBeGreaterThan(0);
    }
  });
});
