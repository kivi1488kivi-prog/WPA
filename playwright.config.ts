import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// E2E runs against: local Postgres (migrations + seed) + local-stack HTTP
// emulator + the production build served with Cloudflare-equivalent rewrites.
// PW_CHROMIUM_PATH overrides; otherwise Playwright's own browser (`npx playwright install chromium`).
const sandboxChromium = '/opt/pw-browsers/chromium';
const chromium = process.env.PW_CHROMIUM_PATH ?? (existsSync(sandboxChromium) ? sandboxChromium : undefined);
const launchOptions = chromium ? { executablePath: chromium } : {};

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, launchOptions }, testMatch: /isolation\.spec/ },
  ],
  webServer: {
    command: 'npx vite build --logLevel warn && npx tsx scripts/build-shells.ts && npx tsx tools/serve-dist.ts 4173',
    url: 'http://localhost:4173/s/demo-studio/',
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
