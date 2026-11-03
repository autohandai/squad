import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["updates.spec.mjs", "announcements.spec.mjs"],
  outputDir: ".codex-artifacts/updates-playwright",
  timeout: 60_000,
  workers: 1,
  retries: 0,
  use: { channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", trace: "retain-on-failure", screenshot: "only-on-failure", reducedMotion: "reduce" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1100 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
});
