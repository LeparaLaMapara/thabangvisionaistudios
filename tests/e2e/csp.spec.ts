import { test, expect, type Page } from '@playwright/test';

// Content-Security-Policy (Phase 6 security INJ-3): script-src is a
// per-request nonce + 'strict-dynamic' set in proxy.ts (lib/security/csp.ts),
// no 'unsafe-inline'. These checks run with the CSP ENFORCED (no bypass):
// every page must still boot the Next.js runtime with zero script-src
// violations, and an injected inline script (what the INJ-1 XSS did) must be
// refused.

const PAGES = ['/', '/rentals', '/rentals/cameras-optics', '/studio', '/login', '/pricing', '/faq', '/legal', '/pay', '/ubunye-ai-studio'];

function scriptViolations(page: Page): string[] {
  const seen: string[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/Content Security Policy/i.test(t) && /script-src/i.test(t)) seen.push(t.slice(0, 200));
  });
  return seen;
}

test.describe('Content-Security-Policy with nonces', () => {
  test('the page CSP has a fresh nonce and no unsafe-inline for scripts', async ({ request }) => {
    const a = (await request.get('/rentals')).headers()['content-security-policy'] ?? '';
    const b = (await request.get('/rentals')).headers()['content-security-policy'] ?? '';
    const scriptSrc = (csp: string) => csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    expect(scriptSrc(a)).toMatch(/'nonce-[^']+'/);
    expect(scriptSrc(a)).toContain("'strict-dynamic'");
    expect(scriptSrc(a)).not.toContain('unsafe-inline');
    expect(a).not.toBe(b);
  });

  for (const path of PAGES) {
    test(`${path} boots with zero script-src violations`, async ({ page }) => {
      const violations = scriptViolations(page);
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await expect
        .poll(() => page.evaluate(() => Boolean((window as unknown as { next?: { version?: string } }).next?.version)), { timeout: 20_000 })
        .toBe(true);
      expect(violations).toEqual([]);
    });
  }

  test('an injected inline script is refused', async ({ page }) => {
    const violations = scriptViolations(page);
    await page.route('**/rentals', async (route) => {
      const res = await route.fetch();
      const html = (await res.text()).replace('</body>', '<script>window.__INJECTED__=1</script></body>');
      await route.fulfill({ response: res, body: html });
    });
    await page.goto('/rentals', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => violations.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as unknown as { __INJECTED__?: number }).__INJECTED__ ?? null)).toBeNull();
  });
});
