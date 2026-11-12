import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: ['grut-conversations.spec.mjs'], workers: 1, retries: 0, timeout: 90000,
  outputDir: '.codex-artifacts/grut',
  use: { channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', trace: 'retain-on-failure', screenshot: 'only-on-failure', reducedMotion: 'reduce' },
  projects: [
    { name: 'desktop-light', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'desktop-dark', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'compact-dark', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
});
