import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startBridge } from "../scripts/lib/reliability-browser.mjs";

let bridge;
test.beforeEach(async () => {
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
test.afterEach(async ({},info) => { if(info.status!==info.expectedStatus)console.error(bridge?.logs.slice(-6000));await bridge?.close(); });

async function open(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { value: "AutohandSquadDesktop/fixture" });
    window.resetCalls = [];
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      window.resetCalls.push({ command, args });
      if (command === "squad_system_reset_status") return { ...args, phase: "complete" };
      return null;
    } };
    if(!localStorage.getItem('external-fixture')) {
      localStorage.setItem("autohandSquad.reset-fixture", "old squad data");
      localStorage.setItem("external-fixture", "keep me");
    }
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

test("reset shows progress, explicitly opens a new dataset, and preserves earlier storage", async ({ page }, info) => {
  const before = (await bridge.api('/api/ownership/context')).data;
  const dialog = await open(page);
  let finish, arrived;
  const started = new Promise(resolve => { arrived = resolve; });
  const complete = new Promise(resolve => { finish = resolve; });
  await page.route("**/api/ownership/operations", async route => {
    arrived(); await complete; await route.continue();
  });
  await dialog.getByTestId("system-reset-confirm").click(); await started;
  await expect(dialog.getByRole("status")).toHaveText("Resetting Squad…");
  await expect(dialog.getByRole("button")).toHaveCount(0);
  await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
  await page.screenshot({ path: info.outputPath("reset-progress.png") });
  finish();
  await expect.poll(async () => (await bridge.api('/api/ownership/context')).data.state,{timeout:30_000}).toBe('awaiting_restart');
  await expect(page.getByRole("heading", {name:"Squad has been reset",exact:true})).toBeVisible({timeout:30_000});
  const after = (await bridge.api('/api/ownership/context')).data;
  expect(after.state).toBe('awaiting_restart');
  expect(after.datasetId).not.toBe(before.datasetId);
  await expect(page.getByRole("button", { name: "Restart Squad", exact: true })).toBeEnabled();
  await page.waitForTimeout(1100);
  expect((await bridge.api('/api/ownership/context')).data.state).toBe('awaiting_restart');
  expect(await page.evaluate(() => localStorage.getItem("autohandSquad.reset-fixture"))).toBe("old squad data");
  await page.screenshot({ path: info.outputPath("reset-complete.png") });
  await Promise.all([page.waitForEvent('domcontentloaded'),page.getByRole("button", { name: "Restart Squad", exact: true }).click()]);
  await expect.poll(async () => (await bridge.api('/api/ownership/context')).data.state).toBe('ready');
  expect(await page.evaluate(() => localStorage.getItem("external-fixture"))).toBe("keep me");
  expect(await page.evaluate(() => localStorage.getItem("autohandSquad.reset-fixture"))).toBe("old squad data");
});

test("a lost reset response recovers the durable receipt without a second reset", async ({ page }) => {
  const dialog = await open(page);
  let posts = 0;
  await page.route("**/api/ownership/operations", async route => {
    posts++; await route.fetch(); await route.abort("failed");
  });
  await dialog.getByTestId("system-reset-confirm").click();
  await expect.poll(async () => (await bridge.api('/api/ownership/context')).data.state,{timeout:30_000}).toBe('awaiting_restart');
  await expect(page.getByRole("heading", { name:"Squad has been reset",exact:true })).toBeVisible({timeout:30_000});
  expect(posts).toBe(1);
  const context = (await bridge.api('/api/ownership/context')).data;
  expect(context.state).toBe('awaiting_restart');
  expect(context.pendingOperation.kind).toBe('reset');
  await expect(page.getByRole("button", { name: "Restart Squad", exact: true })).toBeEnabled();
});

test("an unavailable reset service preserves the dataset and offers Close", async ({ page }) => {
  const before = (await bridge.api('/api/ownership/context')).data;
  const dialog = await open(page);
  await page.route("**/api/ownership/operations", route => route.fulfill({status:503,json:{success:false,error:'The reset service is unavailable.'}}));
  await dialog.getByTestId("system-reset-confirm").click();
  await expect(dialog.getByRole("heading")).toHaveText("Reset could not finish");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const after = (await bridge.api('/api/ownership/context')).data;
  expect(after.datasetId).toBe(before.datasetId);
  expect(after.state).toBe('ready');
});
