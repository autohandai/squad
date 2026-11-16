import { defineConfig, devices } from '@playwright/test';
// ADR-0233: the Minified layout at a laptop window and at phone width.
export default defineConfig({
  testDir: './e2e', testMatch: ['minified-layout.spec.mjs'], workers: 1, retries: 0, timeout: 90000,
  outputDir: '.codex-artifacts/minified',
  use: { channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', trace: 'retain-on-failure', screenshot: 'only-on-failure', reducedMotion: 'reduce' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'phone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
});
