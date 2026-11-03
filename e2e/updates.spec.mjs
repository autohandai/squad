import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startBridge } from "../scripts/lib/reliability-browser.mjs";

let bridge, daemon;
let checks, failCheck, releasedVersion;
const snapshot = () => ({ success: true, checkedAt: new Date().toISOString(), source: "squad-api", currentVersion: "0.1.18", updateAvailable: false, latestAllowedVersion: releasedVersion, notes: "A clearer update experience.", downloadName: `autohand-squad-${releasedVersion}-macos-arm64.dmg`, downloadUrl: `https://github.com/autohandai/squad/releases/download/v${releasedVersion}/autohand-squad-${releasedVersion}-macos-arm64.dmg`, downloadSha256: "a".repeat(64) });

test.beforeAll(async () => {
  checks = 0; failCheck = false; releasedVersion = "0.1.17";
  daemon = createServer(async (req, res) => {
    if (req.url === "/updates/check") {
      checks++;
      if (failCheck) { res.writeHead(503); res.end("unavailable"); return; }
      const result = snapshot();
      await writeFile(join(bridge.directory, "squad", "update.json"), JSON.stringify(result));
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify(result)); return;
    }
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ success: true, data: {} }));
  });
  await new Promise(resolve => daemon.listen(0, "127.0.0.1", resolve));
  bridge = await startBridge({ prepare: async directory => {
    await mkdir(join(directory, "squad"), { recursive: true });
    await writeFile(join(directory, "squad", "daemon.json"), JSON.stringify({ url: `http://127.0.0.1:${daemon.address().port}` }));
    await writeFile(join(directory, "squad", "update.json"), JSON.stringify(snapshot()));
  } });
});
test.afterAll(async () => { await bridge?.close(); await new Promise(resolve => daemon?.close(resolve)); });

test("new release is discovered, preferences persist, and install waits for consent", async ({ page }, testInfo) => {
  let operation = { phase: "complete", version: "0.1.16", message: "Updated to 0.1.16." };
  let installs = 0, downloads = 0;
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  // The actual bridge handles release checks/settings. Installer lifecycle
  // endpoints are fixtures: this test never downloads or executes a binary.
  await page.route("**/api/updates/*", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/updates/upgrade") { downloads++; operation = { phase: "ready", version: "0.1.17", verified: true, installMode: "restart" }; }
    else if (path === "/api/updates/install") { installs++; operation = { ...operation, phase: "installer-open", message: "Installer opened with consent." }; }
    else if (path !== "/api/updates/progress") return route.continue();
    await route.fulfill({ json: { success: true, data: operation } });
  });
  await page.addInitScript(() => {
    localStorage.setItem("autohandSquad.v1.onboarding", '{"version":1,"status":"skipped"}');
    localStorage.setItem("autohandSquad.v1.theme", JSON.stringify({ mode: "dark", lightTheme: "autohand-light", darkTheme: "autohand-dark" }));
  });
  await page.goto(bridge.origin + "/settings/updates");
  const update = page.getByTestId("software-update");
  await expect(update.getByRole("status")).toHaveText("Version 0.1.17 is available");
  await expect(update).not.toContainText("Updated to 0.1.16.");
  const before = checks;
  await update.getByRole("button", { name: "Check for updates", exact: true }).click();
  await expect.poll(() => checks).toBeGreaterThan(before);
  await expect(update.getByRole("status")).toHaveText("Version 0.1.17 is available");
  await page.screenshot({ path: testInfo.outputPath("available.png"), fullPage: true });

  const autoCheck = page.getByRole("switch", { name: "Check for updates automatically", exact: true });
  const autoDownload = page.getByRole("switch", { name: "Download updates automatically", exact: true });
  await expect(autoCheck).toBeChecked(); await expect(autoDownload).not.toBeChecked();
  await page.route("**/api/system/settings", route => route.request().method() === "PUT"
    ? route.fulfill({ status: 500, json: { success: false, error: "Preference save refused" } })
    : route.continue());
  await autoDownload.click();
  await expect(page.getByTestId("update-preferences").getByRole("alert")).toContainText("Preference save refused");
  await expect(autoDownload).not.toBeChecked();
  expect((await bridge.api("/api/system/settings")).data.autoDownloadUpdates).toBe(false);
  await page.unroute("**/api/system/settings");
  // These controls reflect the saved bridge preference, so wait for its
  // response instead of setChecked's synchronous DOM-state requirement.
  await autoCheck.click(); await expect(autoCheck).not.toBeChecked();
  await autoDownload.click(); await expect(autoDownload).toBeChecked();
  await page.reload();
  await expect(autoCheck).not.toBeChecked(); await expect(autoDownload).toBeChecked();
  const saved = (await bridge.api("/api/system/settings")).data;
  expect(saved).toEqual({ autoCheckUpdates: false, autoDownloadUpdates: true });
  const disabledBefore = checks;
  await update.getByRole("button", { name: "Check for updates", exact: true }).click();
  await expect.poll(() => checks).toBeGreaterThan(disabledBefore);
  await expect(update.getByRole("status")).toHaveText("Version 0.1.17 is available");

  failCheck = true;
  await update.getByRole("button", { name: "Check for updates", exact: true }).click();
  await expect(update.getByRole("status")).toHaveText("Could not check for updates");
  await expect(update.getByRole("alert")).toContainText("503");
  failCheck = false;
  await update.getByRole("button", { name: "Check for updates", exact: true }).click();
  await expect(update.getByRole("button", { name: "Download update", exact: true })).toBeVisible();
  await update.getByRole("button", { name: "Download update", exact: true }).click();
  expect(downloads).toBe(1); expect(installs).toBe(0);
  await expect(update.getByRole("button", { name: "Install and restart", exact: true })).toBeVisible();
  await expect(update).toContainText("Installing stops any running work first");
  await page.reload();
  await expect(update.getByRole("button", { name: "Install and restart", exact: true })).toBeVisible();
  expect(installs).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("ready.png"), fullPage: true });

  await page.goto(bridge.origin + "/settings/system");
  await expect(page.getByRole("switch", { name: "Check for updates automatically", exact: true })).toHaveCount(0);
  const notice = page.getByTestId("update-consent-notice");
  await expect(notice).toContainText("0.1.17 is ready");
  await notice.getByRole("button", { name: "Later", exact: true }).click();
  await expect(notice).toHaveCount(0);
  await page.reload(); await expect(notice).toHaveCount(0);
  await page.goto(bridge.origin + "/settings/updates");
  await update.getByRole("button", { name: "Install and restart", exact: true }).click();
  expect(installs).toBe(1);
  await expect(update.getByRole("status")).toHaveText("Installer opened");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
