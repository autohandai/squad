import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: ['setup-guide.spec.mjs'],
  outputDir: '.codex-artifacts/setup-guide', workers: 1, retries: 0, timeout: 90000,
  use: { channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', trace: 'retain-on-failure', screenshot: 'only-on-failure', reducedMotion: 'reduce' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1100 } } },
    { name: 'compact', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }],
});
