#!/usr/bin/env node
// The Marketplace inside Squad (ADR-0246), in both layouts and three skins,
// against a real bridge and the local Squad API (workerd, D1, the 200 seeds):
// browse a category, search by creator and by name, open an agent, Add it,
// see the row say Added; publish a new version and see Update available,
// then Update the member in place; reach it from the directory overflow,
// Minified's More, ⌘K and the /marketplace route; and the offline list.
// Screenshots go to .codex-artifacts/marketplace-in-app.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startBridge, startBrowser, until } from "./lib/reliability-browser.mjs";
import { seedOwnedBrowserFixture } from "./lib/owned-bridge-fixture.mjs";
import { startLocalMarketplace } from "../services/squad-api/scripts/local-marketplace.mjs";

const artifact = ".codex-artifacts/marketplace-in-app";
await mkdir(artifact, { recursive: true });
const freePort = () => new Promise((resolve) => { const server = createServer(); server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); }); });

const persist = await mkdtemp(join(tmpdir(), "squad-marketplace-in-app-"));
const apiPort = await freePort();
let api = await startLocalMarketplace({ port: apiPort, persist });
const bridge = await startBridge({ prepare: async (directory) => {
  const home = join(directory, "home"); await mkdir(home);
  return { HOME: home, USERPROFILE: home, AUTOHAND_SQUAD_API_URL: `http://127.0.0.1:${apiPort}` };
} });
assert.equal((await bridge.api("/api/workspaces/default", "POST", { consent: true })).success, true);
let browser;

const has = (selector, text) => browser.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].some((item) => item.innerText.includes(${JSON.stringify(text)}))`);
const clickText = (selector, text) => browser.evaluate(`(() => { const item = [...document.querySelectorAll(${JSON.stringify(selector)})].find((element) => element.innerText.trim() === ${JSON.stringify(text)}); if (!item) throw new Error("no " + ${JSON.stringify(text)}); item.click(); })()`);
async function press(selector, label = "") {
  const box = await browser.evaluate(`(() => { const items = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((item) => item.getBoundingClientRect().width && (!${JSON.stringify(label)} || item.innerText.trim() === ${JSON.stringify(label)})); const rect = items[0]?.getBoundingClientRect(); return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null; })()`);
  assert.ok(box, `nothing to press at ${selector} ${label}`);
  for (const type of ["mousePressed", "mouseReleased"]) await browser.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
}
const dialogOpen = () => until(() => browser.evaluate(`!!document.querySelector('[data-testid=marketplace-dialog]')`), "the Marketplace dialog");
const listShows = (count) => until(() => browser.evaluate(`document.querySelectorAll('[data-testid=marketplace-list] li').length === ${count}`), `${count} rows`, 20000);
async function closeDialog() {
  await browser.evaluate(`[...document.querySelectorAll('[data-testid=marketplace-dialog] button')].filter((button) => button.innerText.trim() === 'Close').at(-1).click()`);
  await until(() => browser.evaluate(`!document.querySelector('[data-testid=marketplace-dialog]')`), "Marketplace closed");
}
// Waits for the row the search should find, not just for any list: the
// previous result can still be on screen while the debounced search runs.
async function search(text, expect = "") {
  await browser.fill('[aria-label="Search by agent or creator"]', text);
  if (expect) await until(() => browser.evaluate(`[...document.querySelectorAll('[data-testid=marketplace-list] li')].length === 1 && document.querySelector('[data-testid=marketplace-list] li').innerText.includes(${JSON.stringify(expect)})`), `search ${text}`, 20000);
}
// A category word with whatever count it carries now ("All201" after a publish).
const pill = (label) => browser.evaluate(`(() => { const item = [...document.querySelectorAll('[data-testid=marketplace-dialog] [role=tablist] button')].find((element) => element.innerText.trim().replace(/[0-9]+$/, '').trim() === ${JSON.stringify(label)}); if (!item) throw new Error('no pill ' + ${JSON.stringify(label)}); item.click(); })()`);
const receipts = async () => (await bridge.api("/api/marketplace/imports")).data.imports;
async function viewport(width, theme, layout, skin) {
  await browser.send("Emulation.setDeviceMetricsOverride", { width, height: width < 600 ? 844 : 860, deviceScaleFactor: 1, mobile: width < 600 });
  await browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem('autohandSquad.v1.layout', ${JSON.stringify(layout)}); localStorage.setItem('autohandSquad.v1.skin', ${JSON.stringify(skin)}); localStorage.setItem('autohandSquad.v1.theme', JSON.stringify({ mode: ${JSON.stringify(theme)} })); } catch {}` });
}
async function viaCommand() {
  await browser.evaluate(`[...document.querySelectorAll('button')].find((button) => button.innerText.includes('Search everything') || button.getAttribute('aria-label') === 'Search').click()`);
  await until(() => browser.evaluate(`!!document.querySelector('[cmdk-input]')`), "⌘K open");
  await browser.fill("[cmdk-input]", "marketplace");
  await until(() => has("[cmdk-item]", "Marketplace"), "Marketplace in ⌘K");
  await browser.evaluate(`[...document.querySelectorAll('[cmdk-item]')].find((item) => item.innerText.trim() === 'Marketplace').click()`);
  await dialogOpen();
}

try {
  const quill = { id: "asq_quill_in_app", name: "Quill", role: "Release notes writer", description: "Writes release notes.", instructions: "Act as a release notes writer. Read merged changes and write notes people read.", workspace: process.cwd(), projects: [{ path: process.cwd() }], harness: { id: "autohand" }, permissions: {}, skills: [], avatar: "/avatars/birds/tui.webp" };
  browser = await startBrowser();
  await seedOwnedBrowserFixture(bridge, browser, { members: [quill] });

  // 1. Full layout, Autohand skin, light: directory overflow → browse → search → detail → Add.
  await viewport(1280, "light", "full", "default");
  await browser.navigate(`${bridge.origin}/squad`);
  await until(() => browser.evaluate(`!!document.querySelector('[aria-label="Team actions"]')`), "directory", 30000);
  await press('[aria-label="Team actions"]');
  await until(() => browser.evaluate(`!!document.querySelector('[data-testid=open-marketplace]')`), "Marketplace… in the overflow");
  await browser.evaluate(`document.querySelector('[data-testid=open-marketplace]').click()`);
  await dialogOpen();
  await listShows(24);
  await pill("Design");
  await until(() => browser.evaluate(`[...document.querySelectorAll('[data-testid=marketplace-list] li')].length === 20 && [...document.querySelectorAll('[data-testid=marketplace-list] li')].every((row) => row.innerText.includes('Design'))`), "Design category");
  await pill("All");
  await search("autohand squad team");
  await until(() => browser.evaluate(`/Autohand Squad team/.test(document.querySelector('[data-testid=marketplace-list] li')?.innerText || '') && document.querySelector('[data-testid=marketplace-dialog]').innerText.includes('200')`), "search by creator");
  await search("phoebe", "Phoebe by Autohand Squad team");
  const row = await browser.evaluate(`document.querySelector('[data-testid=marketplace-list] li').innerText`);
  assert.match(row, /Phoebe by Autohand Squad team/); assert.match(row, /Added \d{1,2} \w{3} 20\d\d/);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=marketplace-list] li').dataset.state`), "new");
  await browser.screenshot(`${artifact}/full-default-light-browse.png`);
  await browser.evaluate(`document.querySelector('[aria-label="View Phoebe"]').click()`);
  await until(() => has("[data-testid=marketplace-detail]", "payroll-run-bridge"), "Phoebe's page");
  await browser.screenshot(`${artifact}/full-default-light-detail.png`);
  await browser.evaluate(`document.querySelector('[data-testid=marketplace-add]').click()`);
  await until(async () => (await receipts()).some((entry) => entry.memberName === "Phoebe"), "Phoebe added", 60000);

  // Reopen through ⌘K: the row now says Added.
  await viaCommand();
  await search("phoebe", "Phoebe by Autohand Squad team");
  await until(() => browser.evaluate(`document.querySelector('[data-testid=marketplace-list] li')?.dataset.state === 'added'`), "Phoebe's row says Added", 20000);
  assert.match(await browser.evaluate(`document.querySelector('[data-testid=marketplace-row-state]').innerText`), /Added as Phoebe/);
  await browser.screenshot(`${artifact}/full-default-light-added.png`);
  await closeDialog();

  // 2. A listing gets a new version: Update available, then Update in place.
  const listing = { tagline: "Turns merged changes into release notes people read.", description: "", category: "engineering", tags: ["release"] };
  const first = await bridge.api("/api/marketplace/publish", "POST", { member: quill, listing, creatorName: "Quill's maker", requestId: "in-app-quill-0001" });
  assert.equal(first.status, 201, JSON.stringify(first));
  await viaCommand();
  await search("quill's maker", "Quill by Quill's maker");
  await browser.evaluate(`document.querySelector('[aria-label="View Quill"]').click()`);
  await until(() => browser.evaluate(`!!document.querySelector('[data-testid=marketplace-third-party]')`), "Quill's page says who made it");
  await browser.evaluate(`document.querySelector('[data-testid=marketplace-add]').click()`);
  await until(async () => (await receipts()).some((entry) => entry.listingId === first.data.agent.id), "Quill added as a second member", 60000);
  const added = (await receipts()).find((entry) => entry.listingId === first.data.agent.id);
  assert.equal(added.memberName, "Quill 2");
  const v2 = await bridge.api("/api/marketplace/publish", "POST", { member: { ...quill, instructions: `${quill.instructions} Keep each note to two lines.` }, listing, listingId: first.data.agent.id, baseVersion: 1, requestId: "in-app-quill-0002" });
  assert.equal(v2.data.agent.version, 2, JSON.stringify(v2));
  await viaCommand();
  await search("quill's maker", "Quill by Quill's maker");
  await until(() => browser.evaluate(`document.querySelector('[data-testid=marketplace-list] li')?.dataset.state === 'update'`), "Update available", 20000);
  assert.match(await browser.evaluate(`document.querySelector('[data-testid=marketplace-row-state]').innerText`), /Update available/);
  await browser.screenshot(`${artifact}/full-default-light-update-available.png`);
  await browser.evaluate(`document.querySelector('[aria-label="View Quill"]').click()`);
  await until(() => browser.evaluate(`!!document.querySelector('[data-testid=marketplace-update]')`), "Update Quill 2");
  assert.match(await browser.evaluate(`document.querySelector('[data-testid=marketplace-update]').innerText`), /Update Quill 2/);
  await browser.evaluate(`document.querySelector('[data-testid=marketplace-update]').click()`);
  await until(async () => {
    const access = (await bridge.api("/api/channels")).agentChannelAccess || (await bridge.api("/api/channels")).data?.agentChannelAccess || {};
    return String(access[added.memberId]?.agent?.instructions || "").includes("two lines");
  }, "Quill 2's instructions are the new version", 30000);
  await viaCommand();
  await search("quill's maker", "Quill by Quill's maker");
  await until(() => browser.evaluate(`document.querySelector('[data-testid=marketplace-list] li')?.dataset.state === 'added'`), "after Update the row says Added", 20000);
  await closeDialog();

  // 3. Minified layout, Grut skin, dark: More → Marketplace… → a category → detail.
  await viewport(1280, "dark", "minified", "grut");
  await browser.navigate(`${bridge.origin}/squad`);
  await until(() => browser.evaluate(`document.documentElement.dataset.layout === 'minified' && !!document.querySelector('[aria-label="More"]')`), "Minified layout", 30000);
  await press('[aria-label="More"]');
  await until(() => has("[data-testid=minified-more] button", "Marketplace…"), "Marketplace… under More");
  await clickText("[data-testid=minified-more] button", "Marketplace…");
  await dialogOpen();
  await listShows(24);
  await pill("Finance");
  await until(() => browser.evaluate(`[...document.querySelectorAll('[data-testid=marketplace-list] li')].length === 20`), "Finance category");
  await until(() => browser.evaluate(`[...document.querySelectorAll('[data-testid=marketplace-list] li')].some((row) => row.dataset.state === 'added')`), "Phoebe shows Added in Finance");
  await browser.screenshot(`${artifact}/minified-grut-dark-browse.png`);
  await browser.evaluate(`document.querySelector('[aria-label="View Penelope"]').click()`);
  await until(() => has("[data-testid=marketplace-detail]", "Instructions"), "Penelope's page");
  await browser.screenshot(`${artifact}/minified-grut-dark-detail.png`);
  await closeDialog();

  // 4. Minified, Paper skin, light, phone width: the /marketplace route, then offline.
  await viewport(390, "light", "minified", "paper");
  await browser.navigate(`${bridge.origin}/marketplace`);
  await dialogOpen();
  await listShows(24);
  assert.equal(await browser.evaluate("location.pathname"), "/squad");
  assert.equal(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "no sideways scroll on a phone");
  await browser.screenshot(`${artifact}/minified-paper-phone-browse.png`);
  await api.dispose();
  await pill("Personal");
  await pill("All");
  await until(() => browser.evaluate(`!!document.querySelector('[data-testid=marketplace-offline]') && document.querySelectorAll('[data-testid=marketplace-list] li').length === 24`), "offline: the last list, with Retry", 30000);
  assert.match(await browser.evaluate(`document.querySelector('[data-testid=marketplace-offline]').innerText`), /Offline · showing the list from \d{2}:\d{2}\.\s+Retry/);
  await browser.screenshot(`${artifact}/minified-paper-phone-offline.png`);
  api = await startLocalMarketplace({ port: apiPort, persist, seed: false });
  await clickText("[data-testid=marketplace-offline] button", "Retry");
  await until(() => browser.evaluate(`!document.querySelector('[data-testid=marketplace-offline]')`), "Retry brings it back online", 20000);

  assert.deepEqual(browser.errors, []);
  console.log("PASS: in-app Marketplace: browse, search by creator and name, detail, Add, Added and Update available with Update in place, from the overflow, ⌘K, Minified More and /marketplace, in Full and Minified across three skins, and offline with Retry.");
} catch (error) {
  await browser?.screenshot(`${artifact}/failure.png`).catch(() => {});
  console.error(await browser?.evaluate("document.body.innerText.slice(0, 2500)").catch(() => ""));
  throw error;
} finally {
  await browser?.close();
  await bridge.close();
  await api?.dispose().catch(() => {});
  await rm(persist, { recursive: true, force: true });
}
