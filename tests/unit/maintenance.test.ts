import { describe, it, expect } from 'vitest';
import {
  decideMaintenance,
  isMaintenanceOn,
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
