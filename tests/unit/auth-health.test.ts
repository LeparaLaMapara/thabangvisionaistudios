import { describe, expect, it } from 'vitest';
import {
  checkGoogleAuthorize,
  checkSitePages,
  compareAuthConfig,
  normaliseAllowList,
  renderReport,
  riskyAuthSettings,
} from '../../scripts/ops/auth-health-core.mjs';

const REF = 'abcdefghijklmnopqrst';
const SITE = 'https://www.example-site.test';
const expected = {
  site_url: SITE,
  uri_allow_list: ['https://example-site.test/**', `${SITE}/**`],
  external_google_enabled: true,
};

describe('sign-in settings drift', () => {
  it('passes when the live settings match, whatever the allow list order or spacing', () => {
    const live = { site_url: SITE, uri_allow_list: `${SITE}/** , https://example-site.test/**`, external_google_enabled: true, other: 1 };
    expect(compareAuthConfig(expected, live)).toEqual([]);
  });

  it('flags a changed Site URL, the cause of "sent to the wrong address after Google"', () => {
    const live = { ...expected, uri_allow_list: expected.uri_allow_list.join(','), site_url: 'http://localhost:3000' };
    const f = compareAuthConfig(expected, live);
    expect(f.map((x) => x.id)).toEqual(['drift:site_url']);
    expect(f[0].severity).toBe('critical');
  });

  it('flags a missing allow list entry and a disabled provider', () => {
    const live = { site_url: SITE, uri_allow_list: `${SITE}/**`, external_google_enabled: false };
    expect(compareAuthConfig(expected, live).map((x) => x.id)).toEqual(['drift:uri_allow_list', 'drift:external_google_enabled']);
  });

  it('normalises allow lists from either a string or an array', () => {
    expect(normaliseAllowList(' b , a,,')).toEqual(['a', 'b']);
    expect(normaliseAllowList(['b', 'a'])).toEqual(['a', 'b']);
  });
});

describe('risky settings', () => {
  it('warns when email sign-up needs confirmation but only the built-in mailer sends it', () => {
    const f = riskyAuthSettings({ smtp_host: null, external_email_enabled: true, mailer_autoconfirm: false, rate_limit_email_sent: 2 });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ id: 'risk:builtin-mailer', severity: 'warning' });
    expect(f[0].detail).toContain('2 per hour');
  });

  it('is quiet once custom SMTP is configured', () => {
    expect(riskyAuthSettings({ smtp_host: 'smtp.example.test', external_email_enabled: true, mailer_autoconfirm: false })).toEqual([]);
  });
});

describe('Google authorize redirect', () => {
  const ok = `https://accounts.google.com/o/oauth2/v2/auth?client_id=cid&redirect_uri=${encodeURIComponent(`https://${REF}.supabase.co/auth/v1/callback`)}&state=x`;

  it('passes for Google, this project callback and the expected client', () => {
    expect(checkGoogleAuthorize(ok, { projectRef: REF, clientId: 'cid' })).toEqual([]);
  });

  it('flags the wrong callback and the wrong client', () => {
    const bad = ok.replace(REF, 'zzzzzzzzzzzzzzzzzzzz').replace('client_id=cid', 'client_id=other');
    expect(checkGoogleAuthorize(bad, { projectRef: REF, clientId: 'cid' }).map((x) => x.id)).toEqual(['google:redirect-uri', 'google:client']);
  });

  it('flags a missing redirect', () => {
    expect(checkGoogleAuthorize('', { projectRef: REF, clientId: 'cid' })[0].id).toBe('google:no-redirect');
  });
});

describe('sign-in pages', () => {
  const apexOk = { status: 308, location: `${SITE}/login`, title: '' };

  it('accepts the maintenance page while maintenance is expected', () => {
    const probes = { apexLogin: apexOk, login: { status: 503, location: null, title: 'Site | Under maintenance' } };
    expect(checkSitePages(probes, { siteOrigin: SITE, maintenanceExpected: true })).toEqual([]);
  });

  it('is critical when maintenance appears unexpectedly', () => {
    const probes = { apexLogin: apexOk, login: { status: 503, location: null, title: 'Under maintenance' } };
    expect(checkSitePages(probes, { siteOrigin: SITE, maintenanceExpected: false })[0].id).toBe('site:maintenance');
  });

  it('is critical when the login page errors, and when the bare domain stops redirecting', () => {
    const probes = { apexLogin: { status: 200, location: null, title: '' }, login: { status: 500, location: null, title: 'Error' } };
    expect(checkSitePages(probes, { siteOrigin: SITE, maintenanceExpected: false }).map((x) => x.id)).toEqual(['site:apex', 'site:login']);
  });

  it('nudges to update the expectation once maintenance is over', () => {
    const probes = { apexLogin: apexOk, login: { status: 200, location: null, title: 'Site' } };
    expect(checkSitePages(probes, { siteOrigin: SITE, maintenanceExpected: true })[0]).toMatchObject({ id: 'site:maintenance-over', severity: 'warning' });
  });
});

describe('report', () => {
  it('lists critical findings before warnings and links the run', () => {
    const md = renderReport(
      [
        { id: 'w', severity: 'warning', title: 'W', detail: 'w' },
        { id: 'c', severity: 'critical', title: 'C', detail: 'c' },
      ],
      { ranAt: 'now', runUrl: 'https://run' },
    );
    expect(md.indexOf('### Critical')).toBeLessThan(md.indexOf('### Warnings'));
    expect(md).toContain('Run: https://run');
  });
});
