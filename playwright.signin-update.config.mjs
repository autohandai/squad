import { defineConfig, devices } from "@playwright/test";

// Sign-in and update screens rendered from fixtures (e2e/fixtures), no bridge
// and no account. Screenshots land in the output directory for review.
const port = Number(process.env.SIGNIN_UPDATE_PORT || 5287);
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["signin-update.spec.mjs"],
  outputDir: ".codex-artifacts/signin-update",
  timeout: 60_000,
  workers: 1,
  retries: 0,
  use: { channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  webServer: { command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}/e2e/fixtures/signin-update.html`, reuseExistingServer: false, timeout: 60_000 },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 820 } } },
    { name: "phone", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
});
