import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: ['titlebar.spec.mjs'],
  outputDir: '.codex-artifacts/titlebar', workers: 1, retries: 0,
  use: { channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', trace: 'retain-on-failure' },
});
