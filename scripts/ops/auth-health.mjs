#!/usr/bin/env node
/**
 * Sign-in health check for production. Run by .github/workflows/auth-health.yml
 * every 30 minutes; safe to run by hand:
 *
 *   SUPABASE_ACCESS_TOKEN=... node scripts/ops/auth-health.mjs
 *
 * Read-only. It reads the Supabase Auth settings (Management API, needs
 * SUPABASE_ACCESS_TOKEN; skipped with a warning when absent), starts a Google
 * sign-in without completing it, and fetches the public sign-in pages. It never
 * signs anyone in and never changes a setting.
 *
 * Writes the findings as JSON to --out (default auth-health.json) and the
 * Markdown report to --report (default auth-health.md). Exit code 1 when any
 * finding is critical, so the workflow can open an incident.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  checkGoogleAuthorize,
  checkSitePages,
  compareAuthConfig,
  renderReport,
  riskyAuthSettings,
} from './auth-health-core.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};

const expected = JSON.parse(readFileSync(new URL('../../ops/auth/expected-auth-config.json', import.meta.url), 'utf8'));
const { projectRef, siteOrigin, apexOrigin, auth, maintenanceExpected } = expected;

/** @type {import('./auth-health-core.mjs').Finding[]} */
const findings = [];

async function probe(url) {
  const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': 'thabangvision-auth-health' } });
  const body = res.status < 300 || res.status >= 500 ? await res.text() : '';
  const title = /<title>([^<]*)/i.exec(body)?.[1] ?? '';
  return { status: res.status, location: res.headers.get('location'), title };
}

async function step(name, fn) {
  try {
    await fn();
  } catch (err) {
    findings.push({ id: `error:${name}`, severity: 'critical', title: `The "${name}" check could not run`, detail: err instanceof Error ? err.message : String(err) });
  }
}

await step('settings', async () => {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    findings.push({ id: 'skip:settings', severity: 'warning', title: 'Settings drift not checked', detail: 'SUPABASE_ACCESS_TOKEN is not set, so the live Auth settings were not compared with ops/auth/expected-auth-config.json.' });
    return;
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
    headers: { authorization: `Bearer ${token}`, 'user-agent': 'thabangvision-auth-health' },
  });
  if (!res.ok) throw new Error(`Management API answered ${res.status}`);
  const live = await res.json();
  findings.push(...compareAuthConfig(auth, live), ...riskyAuthSettings(live));
});

await step('google', async () => {
  const redirectTo = encodeURIComponent(`${siteOrigin}/auth/callback`);
  const res = await fetch(`https://${projectRef}.supabase.co/auth/v1/authorize?provider=google&redirect_to=${redirectTo}`, { redirect: 'manual' });
  findings.push(...checkGoogleAuthorize(res.headers.get('location') ?? '', { projectRef, clientId: auth.external_google_client_id }));
});

await step('pages', async () => {
  const probes = { apexLogin: await probe(`${apexOrigin}/login`), login: await probe(`${siteOrigin}/login`) };
  findings.push(...checkSitePages(probes, { siteOrigin, maintenanceExpected }));
});

const runUrl = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : '';
const report = renderReport(findings, { ranAt: new Date().toISOString(), runUrl });
writeFileSync(arg('--out', 'auth-health.json'), JSON.stringify(findings, null, 2));
writeFileSync(arg('--report', 'auth-health.md'), report);
console.log(report);
process.exit(findings.some((f) => f.severity === 'critical') ? 1 : 0);
