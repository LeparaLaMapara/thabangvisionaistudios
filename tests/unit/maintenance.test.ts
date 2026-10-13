import { describe, it, expect } from 'vitest';
import {
  decideMaintenance,
  isMaintenanceOn,
  isNightOpen,
  maintenancePageHtml,
  type MaintenanceInput,
} from '@/lib/maintenance';
import { STUDIO } from '@/lib/constants';

const TOKEN = 'a-long-secret-bypass-token-123';

function input(overrides: Partial<MaintenanceInput> = {}): MaintenanceInput {
  return {
    pathname: '/',
    previewParam: null,
    bypassCookie: undefined,
    maintenanceMode: 'true',
    bypassToken: TOKEN,
    ...overrides,
  };
}

describe('isMaintenanceOn', () => {
  it('is on only for "true" (any case, trimmed)', () => {
    expect(isMaintenanceOn('true')).toBe(true);
    expect(isMaintenanceOn(' TRUE ')).toBe(true);
    expect(isMaintenanceOn('false')).toBe(false);
    expect(isMaintenanceOn('1')).toBe(false);
    expect(isMaintenanceOn(undefined)).toBe(false);
  });
});

describe('decideMaintenance', () => {
  it('passes everything through when maintenance is off', () => {
    expect(decideMaintenance(input({ maintenanceMode: undefined }))).toEqual({ action: 'pass' });
    expect(decideMaintenance(input({ maintenanceMode: 'false', pathname: '/api/cart' }))).toEqual({ action: 'pass' });
  });

  it('shows the maintenance page for pages', () => {
    expect(decideMaintenance(input())).toEqual({ action: 'page' });
    expect(decideMaintenance(input({ pathname: '/dashboard/bookings' }))).toEqual({ action: 'page' });
    expect(decideMaintenance(input({ pathname: '/login' }))).toEqual({ action: 'page' });
  });

  it('returns a 503 decision for API routes', () => {
    expect(decideMaintenance(input({ pathname: '/api/cart/checkout' }))).toEqual({ action: 'api' });
  });

  it('keeps payment webhooks and cron jobs live', () => {
    expect(decideMaintenance(input({ pathname: '/api/webhooks/paystack' }))).toEqual({ action: 'pass' });
    expect(decideMaintenance(input({ pathname: '/api/cron/daily-maintenance' }))).toEqual({ action: 'pass' });
    expect(decideMaintenance(input({ pathname: '/robots.txt' }))).toEqual({ action: 'pass' });
  });

  it('sets the bypass cookie when the preview token is correct', () => {
    expect(decideMaintenance(input({ previewParam: TOKEN }))).toEqual({ action: 'set-bypass', token: TOKEN });
  });

  it('rejects a wrong preview token', () => {
    expect(decideMaintenance(input({ previewParam: 'wrong' }))).toEqual({ action: 'page' });
    expect(decideMaintenance(input({ previewParam: TOKEN.slice(0, -1) + 'x' }))).toEqual({ action: 'page' });
  });

  it('lets a browser with the bypass cookie through', () => {
    expect(decideMaintenance(input({ bypassCookie: TOKEN }))).toEqual({ action: 'pass' });
    expect(decideMaintenance(input({ bypassCookie: TOKEN, pathname: '/api/cart' }))).toEqual({ action: 'pass' });
  });

  it('does not honour a stale cookie after the token changes', () => {
    expect(decideMaintenance(input({ bypassCookie: 'old-token-that-was-long-enough' }))).toEqual({ action: 'page' });
  });

  it('disables bypass when the token is missing or too short', () => {
    expect(decideMaintenance(input({ bypassToken: undefined, previewParam: '' }))).toEqual({ action: 'page' });
    expect(decideMaintenance(input({ bypassToken: 'short', previewParam: 'short' }))).toEqual({ action: 'page' });
    expect(decideMaintenance(input({ bypassToken: 'short', bypassCookie: 'short' }))).toEqual({ action: 'page' });
  });

  it('clears the bypass with ?preview=off', () => {
    expect(decideMaintenance(input({ previewParam: 'off', bypassCookie: TOKEN }))).toEqual({ action: 'clear-bypass' });
  });
});

describe('maintenancePageHtml', () => {
  it('is a noindex page that uses the business email from constants', () => {
    const html = maintenancePageHtml();
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain(`mailto:${STUDIO.email}`);
    expect(html).not.toMatch(/<script/i);
  });
});

describe('night opening (MAINTENANCE_OPEN_NIGHTS_UNTIL)', () => {
  const UNTIL = '2026-10-19T05:00:00+02:00';
  // Times are given in UTC; South Africa is UTC+2.
  const at = (iso: string) => new Date(iso);

  it('opens the site from 00:00 to 05:00 South African time', () => {
    expect(isNightOpen(UNTIL, at('2026-10-13T22:00:00Z'))).toBe(true); // 00:00 SAST
    expect(isNightOpen(UNTIL, at('2026-10-14T02:59:59Z'))).toBe(true); // 04:59 SAST
    expect(isNightOpen(UNTIL, at('2026-10-14T03:00:00Z'))).toBe(false); // 05:00 SAST
    expect(isNightOpen(UNTIL, at('2026-10-13T21:59:59Z'))).toBe(false); // 23:59 SAST
    expect(isNightOpen(UNTIL, at('2026-10-14T10:00:00Z'))).toBe(false); // midday
  });

  it('stops after the cut-off date, and does nothing when unset or invalid', () => {
    expect(isNightOpen(UNTIL, at('2026-10-19T03:00:00Z'))).toBe(false);
    expect(isNightOpen(UNTIL, at('2026-10-19T22:30:00Z'))).toBe(false);
    expect(isNightOpen(undefined, at('2026-10-13T23:00:00Z'))).toBe(false);
    expect(isNightOpen('', at('2026-10-13T23:00:00Z'))).toBe(false);
    expect(isNightOpen('next week', at('2026-10-13T23:00:00Z'))).toBe(false);
  });

  it('lets every page through during the night window, and shows maintenance by day', () => {
    const night = input({ openNightsUntil: UNTIL, now: at('2026-10-13T23:00:00Z') });
    expect(decideMaintenance(night)).toEqual({ action: 'pass' });
    expect(decideMaintenance({ ...night, pathname: '/api/cart' })).toEqual({ action: 'pass' });
    const day = input({ openNightsUntil: UNTIL, now: at('2026-10-14T08:00:00Z') });
    expect(decideMaintenance(day)).toEqual({ action: 'page' });
  });
});
