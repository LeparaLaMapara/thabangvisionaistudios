import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 60_000,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: 'mobile.spec.ts',
    },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 393, height: 852 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: devices['iPhone 14'].userAgent,
      },
      testMatch: 'mobile.spec.ts',
    },
  ],
  webServer: {
    command: 'npm run build && npm start',
    port: 3000,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      // proxy.ts validates the Origin header on every API mutation against
      // NEXT_PUBLIC_APP_URL. Left pointing at production, every browser-driven
      // POST from the suite is rejected with "Invalid origin." -- which is the
      // CSRF guard working correctly against a misconfigured test server.
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    },
  },
});
