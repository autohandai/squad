import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startBridge } from "../scripts/lib/reliability-browser.mjs";

let bridge;
test.beforeAll(async () => {
  bridge = await startBridge({ prepare: async directory => {
    const home = join(directory, "home");
    await mkdir(home);
    const preload = join(directory, "isolate-home.mjs");
    await writeFile(preload, `import os from 'node:os';import{syncBuiltinESMExports}from'node:module';os.homedir=()=>${JSON.stringify(home)};syncBuiltinESMExports();`);
    const sdk = join(directory, "fixture-sdk.mjs");
    await writeFile(sdk, "export class AutohandSDK { async start() {} async close() {} async interrupt() {} }");
    return { NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, AUTOHAND_AGENT_SDK_ENTRY: sdk, AUTOHAND_AGENT_SDK_DIR: directory, AUTOHAND_SQUAD_COMPUTER_USE: "bundled", AUTOHAND_SQUAD_COMPUTER_USE_RUNTIME_DIR: directory };
  } });
});
test.afterAll(async () => { await bridge?.close(); });

async function open(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { value: "AutohandSquadDesktop/fixture" });
    window.resetCalls = [];
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      window.resetCalls.push({ command, args });
      if (command === "squad_system_reset_status") return { ...args, phase: "complete" };
      return null;
    } };
    localStorage.setItem("autohandSquad.v1.onboarding", '{"version":1,"status":"skipped"}');
    localStorage.setItem("autohandSquad.reset-fixture", "old squad data");
    localStorage.setItem("external-fixture", "keep me");
  });
  // An accidental request must never reach the real reset route, even though
  // the bridge's managed workspace roots are isolated too.
  await page.route("**/api/system/reset", route => route.fulfill({ status: 500, json: { success: false, error: "Unexpected reset in browser fixture" } }));
  await page.goto(bridge.origin + "/settings/system");
  await page.getByRole("button", { name: "Reset Squad…", exact: true }).click();
  return page.getByTestId("system-reset-dialog");
}

test("reset confirmation arms quit guard and both cancellation paths release it", async ({ page }) => {
  const dialog = await open(page);
  await expect(dialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => resetCalls.filter(c => c.command === "squad_set_system_reset_stage").map(c => c.args.stage))).toEqual(["confirm"]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Reset Squad…", exact: true }).click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => resetCalls.filter(c => c.command === "squad_set_system_reset_stage").map(c => c.args.stage))).toEqual(["confirm", "idle", "confirm", "idle"]);
});

test("reset shows progress, requires explicit restart, and clears only Squad storage", async ({ page }, info) => {
  const dialog = await open(page);
  let finish, arrived;
  const { pid: previousPid } = await (await fetch(bridge.origin + "/api/health")).json();
  const started = new Promise(resolve => { arrived = resolve; });
  const complete = new Promise(resolve => { finish = resolve; });
  await page.route("**/api/system/reset", async route => {
    const body = route.request().postDataJSON(); arrived(); await complete;
    await route.fulfill({ json: { success: true, data: { requestId: body.requestId, previousPid, phase: "complete", moved: [] } } });
  });
  await dialog.getByTestId("system-reset-confirm").click(); await started;
  await expect(dialog.getByRole("status")).toHaveText("Resetting Squad…");
  await expect(dialog).toContainText("Don’t quit Squad");
  await expect(dialog.getByRole("button")).toHaveCount(0);
  await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
  await page.screenshot({ path: info.outputPath("reset-progress.png") });
  finish();
  await page.route("**/api/health", route => route.fulfill({ json: { success: true, service: "autohand-squad-bridge", pid: previousPid + 1 } }));
  await expect(dialog.getByRole("heading")).toHaveText("Squad has been reset");
  await expect(dialog.getByRole("button")).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Restart Squad", exact: true })).toBeEnabled();
  await page.waitForTimeout(3100);
  expect(page.url()).toBe(bridge.origin + "/settings/system");
  expect(await page.evaluate(() => localStorage.getItem("autohandSquad.reset-fixture"))).toBe("old squad data");
  await page.screenshot({ path: info.outputPath("reset-complete.png") });
  await dialog.getByRole("button", { name: "Restart Squad", exact: true }).click();
  await expect.poll(() => page.evaluate(() => resetCalls.filter(c => c.command === "squad_restart_after_system_reset").length)).toBe(1);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("autohandSquad.")))).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("external-fixture"))).toBe("keep me");
  expect(await page.evaluate(() => resetCalls.filter(c => c.command === "squad_set_system_reset_stage").map(c => c.args.stage))).toEqual(["confirm", "working", "complete"]);
});

test("a lost reset response checks its receipt without repeating the reset", async ({ page }) => {
  const dialog = await open(page);
  let posts = 0;
  await page.route("**/api/system/reset", async route => { posts++; await route.abort("failed"); });
  await dialog.getByTestId("system-reset-confirm").click();
  await expect(dialog.getByRole("heading")).toHaveText("Squad has been reset");
  expect(posts).toBe(1);
  expect(await page.evaluate(() => resetCalls.some(c => c.command === "squad_system_reset_status"))).toBe(true);
  await expect(dialog.getByRole("button")).toHaveCount(1);
});

test("an unavailable service leaves confirmation cancellable before reset starts", async ({ page }) => {
  const dialog = await open(page);
  await page.route("**/api/health", route => route.fulfill({ status: 503, json: {} }));
  await dialog.getByTestId("system-reset-confirm").click();
  await expect(dialog.getByRole("alert")).toContainText("has not answered");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => resetCalls.some(c => c.args?.stage === "working"))).toBe(false);
});
