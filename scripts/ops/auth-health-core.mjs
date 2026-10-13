/**
 * Sign-in health: the pure part. No network, no environment. scripts/ops/auth-health.mjs
 * gathers the facts and calls these; tests/unit/auth-health.test.ts tests them.
 *
 * Every check here maps to a way sign-in has broken, or would break, for a real
 * person: a changed Site URL or allow list sends people back to the wrong address
 * after Google, a disabled provider removes the button's backend, and the built-in
 * mailer caps confirmation emails so new accounts silently never confirm.
 */

/** @typedef {{ id: string, severity: 'critical' | 'warning', title: string, detail: string }} Finding */

/** Compare a live allow list (comma string or array) with the expected one, ignoring order and spaces. */
export function normaliseAllowList(value) {
  const items = Array.isArray(value) ? value : String(value ?? '').split(',');
  return items.map((s) => String(s).trim()).filter(Boolean).sort();
}

/**
 * Settings drift: every key in `expected` must equal the live value.
 * @returns {Finding[]}
 */
export function compareAuthConfig(expected, live) {
  /** @type {Finding[]} */
  const findings = [];
  for (const [key, want] of Object.entries(expected)) {
    const got = live?.[key];
    const same =
      key === 'uri_allow_list'
        ? JSON.stringify(normaliseAllowList(want)) === JSON.stringify(normaliseAllowList(got))
        : want === got;
    if (!same) {
      findings.push({
        id: `drift:${key}`,
        severity: 'critical',
        title: `Sign-in setting "${key}" changed`,
        detail: `Expected ${JSON.stringify(want)}, live is ${JSON.stringify(got)}. If this change was deliberate, update ops/auth/expected-auth-config.json in the same PR; if not, put the setting back in Supabase > Authentication.`,
      });
    }
  }
  return findings;
}

/**
 * Settings that are "as configured" but still hurt people. Warnings, not drift.
 * @returns {Finding[]}
 */
export function riskyAuthSettings(live) {
  /** @type {Finding[]} */
  const findings = [];
  const usesBuiltInMailer = !live?.smtp_host;
  const needsConfirmation = live?.external_email_enabled === true && live?.mailer_autoconfirm === false;
  if (usesBuiltInMailer && needsConfirmation) {
    findings.push({
      id: 'risk:builtin-mailer',
      severity: 'warning',
      title: 'Email sign-ups depend on the built-in mailer',
      detail: `No custom SMTP is set, so Supabase's built-in mailer sends confirmation and reset emails, limited to ${live?.rate_limit_email_sent ?? 'a few'} per hour for the whole site. Past that, new accounts never get their confirmation email and cannot sign in. Fix: set custom SMTP (Supabase > Authentication > SMTP) and raise the email rate limit.`,
    });
  }
  return findings;
}

/**
 * The Google authorize redirect: Supabase must send people to Google with this
 * project's own callback and the expected client.
 * @returns {Finding[]}
 */
export function checkGoogleAuthorize(location, { projectRef, clientId }) {
  /** @type {Finding[]} */
  const findings = [];
  let url;
  try {
    url = new URL(location);
  } catch {
    return [{ id: 'google:no-redirect', severity: 'critical', title: 'Google sign-in does not start', detail: `The authorize endpoint did not redirect to Google (got ${JSON.stringify(location)}).` }];
  }
  if (url.hostname !== 'accounts.google.com') {
    findings.push({ id: 'google:wrong-host', severity: 'critical', title: 'Google sign-in redirects somewhere else', detail: `Expected accounts.google.com, got ${url.hostname}.` });
  }
  const callback = `https://${projectRef}.supabase.co/auth/v1/callback`;
  if (url.searchParams.get('redirect_uri') !== callback) {
    findings.push({ id: 'google:redirect-uri', severity: 'critical', title: 'Google sign-in returns to the wrong callback', detail: `Expected redirect_uri ${callback}, got ${url.searchParams.get('redirect_uri')}. Google rejects a redirect_uri that is not registered on the OAuth client.` });
  }
  if (clientId && url.searchParams.get('client_id') !== clientId) {
    findings.push({ id: 'google:client', severity: 'critical', title: 'Google sign-in uses a different OAuth client', detail: `Expected ${clientId}, got ${url.searchParams.get('client_id')}.` });
  }
  return findings;
}

/**
 * The site's own sign-in pages, as a stranger reaches them.
 * `probes` holds { status, location, title } per probe.
 * @returns {Finding[]}
 */
export function checkSitePages(probes, { siteOrigin, maintenanceExpected }) {
  /** @type {Finding[]} */
  const findings = [];
  const apex = probes.apexLogin;
  if (!apex || ![301, 302, 307, 308].includes(apex.status) || !String(apex.location ?? '').startsWith(`${siteOrigin}/login`)) {
    findings.push({ id: 'site:apex', severity: 'critical', title: 'The address without www does not lead to sign-in', detail: `Expected a redirect to ${siteOrigin}/login, got ${apex?.status} ${apex?.location ?? ''}.` });
  }
  const login = probes.login;
  const inMaintenance = login?.status === 503 && /maintenance/i.test(login?.title ?? '');
  if (inMaintenance && !maintenanceExpected) {
    findings.push({ id: 'site:maintenance', severity: 'critical', title: 'The site is showing the maintenance page', detail: 'The sign-in page answers 503 "Under maintenance" but maintenance is not expected (ops/auth/expected-auth-config.json).' });
  } else if (!inMaintenance && login?.status !== 200) {
    findings.push({ id: 'site:login', severity: 'critical', title: 'The sign-in page is not loading', detail: `${siteOrigin}/login answered ${login?.status}.` });
  } else if (!inMaintenance && maintenanceExpected) {
    findings.push({ id: 'site:maintenance-over', severity: 'warning', title: 'Maintenance looks finished', detail: 'The sign-in page loads normally. Set "maintenanceExpected": false in ops/auth/expected-auth-config.json so a return to maintenance is caught.' });
  }
  return findings;
}

/** One Markdown body for the incident issue. */
export function renderReport(findings, { ranAt, runUrl }) {
  const critical = findings.filter((f) => f.severity === 'critical');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const lines = [`Sign-in health check, ${ranAt}.`, ''];
  if (critical.length === 0) lines.push('No critical problems.', '');
  for (const group of [['Critical', critical], ['Warnings', warnings]]) {
    if (group[1].length === 0) continue;
    lines.push(`### ${group[0]}`, '');
    for (const f of group[1]) lines.push(`- **${f.title}** (\`${f.id}\`): ${f.detail}`);
    lines.push('');
  }
  if (runUrl) lines.push(`Run: ${runUrl}`);
  return lines.join('\n');
}
