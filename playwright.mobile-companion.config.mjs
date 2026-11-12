import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: ['mobile-companion.spec.mjs'],
  outputDir: '.codex-artifacts/mobile-companion', workers: 1, retries: 0, timeout: 90000,
  use: { channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', trace: 'retain-on-failure', screenshot: 'only-on-failure', reducedMotion: 'reduce' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1100 } } },
    { name: 'compact', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }],
});
