import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end journeys against a fully LOCAL stack (local Supabase, the fake
 * Paystack/Nominatim stub, a production build on :3000). See README.md here.
 *
 * Not part of `npm run test:e2e` (that suite's testDir is ./tests/e2e).
 * Run with `npm run test:e2e:local` after sourcing the local env file.
 */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.journey\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    // The site's CSP allows Supabase only at https://*.supabase.co; the local
    // stack serves it from http://127.0.0.1:54321, which the browser would
    // block. Bypass CSP locally (production CSP is unchanged and still checked
    // by the default suite against the hosted project).
    bypassCSP: true,
    // A browser always sends Origin with a POST/PUT/PATCH/DELETE; the
    // journeys' direct API calls (page.request) must too, or proxy.ts's CSRF
    // check refuses them (a session cookie with no Origin/Referer is exactly
    // what security finding AUTH-4 closed).
    extraHTTPHeaders: { Origin: new URL(process.env.BASE_URL || 'http://localhost:3000').origin },
    launchOptions: executablePath ? { executablePath } : {},
  },
  outputDir: '../../test-results/e2e-local',
  webServer: undefined,
});
