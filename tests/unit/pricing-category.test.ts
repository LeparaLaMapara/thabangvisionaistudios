import { describe, it, expect } from 'vitest';
import { getHourlyRate } from '@/lib/supabase/queries/service-bookings';

/**
 * project_category reaches getHourlyRate as free text from the AI booking
 * tool, and the function is a chain of substring tests. Order therefore sets
 * the price. 'portrait' and 'product' used to be tested before the
 * cinematography list, so "product video" and "corporate video portrait"
 * priced at the photography rate -- model-steerable underpricing on live
 * bookings. These cases pin the order.
 */
describe('getHourlyRate category ordering', () => {
  it('prices plain photography categories at the photography rate', () => {
    expect(getHourlyRate('portrait')).toBe(1500);
    expect(getHourlyRate('product photography')).toBe(1500);
    expect(getHourlyRate('real estate')).toBe(1500);
  });

  it('prices cinematography at the cinematography rate', () => {
    expect(getHourlyRate('cinematography')).toBe(2850);
    expect(getHourlyRate('music video')).toBe(2850);
    expect(getHourlyRate('documentary')).toBe(2850);
  });

  it('does not let a photography word downgrade a video shoot', () => {
    // Each of these contains a photography substring AND is a video job.
    expect(getHourlyRate('product video')).toBe(2850);
    expect(getHourlyRate('corporate video portrait session')).toBe(2850);
    expect(getHourlyRate('real estate video tour')).toBe(2850);
  });

  it('is case insensitive', () => {
    expect(getHourlyRate('CORPORATE VIDEO')).toBe(2850);
    expect(getHourlyRate('Portrait')).toBe(1500);
  });
});
