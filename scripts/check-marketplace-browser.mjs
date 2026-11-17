#!/usr/bin/env node
// The agent marketplace in the app (ADR-0246), against a real bridge, the
// local Squad API (workerd, D1, the 350 seed agents and 21 teams) and a loopback stand-in for x.ai:
// Explore by category and search, an agent's page, Add to squad, the
// squad://-style route with its checksum, Add another, a refused checksum, a
// Grok Bot link, Publish to marketplace from the member menu, and the
// offline list. Screenshots go to .codex-artifacts/marketplace.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startBridge, startBrowser, until } from "./lib/reliability-browser.mjs";
import { seedOwnedBrowserFixture } from "./lib/owned-bridge-fixture.mjs";
import { startLocalMarketplace } from "../services/squad-api/scripts/local-marketplace.mjs";

const artifact = ".codex-artifacts/marketplace";
await mkdir(artifact, { recursive: true });
const freePort = () => new Promise((resolve) => { const server = createServer(); server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); }); });

const grok = createServer((request, response) => {
  const id = request.url.replace(/^\/bot\//, "");
  const data = { id, ownerType: "USER", sharerName: null, botName: "tide clock", description: "Plans a fishing day around tides and weather, and says when to stay home.", addHref: `grokbot://app/v1/bot-template?id=${id}`, color: "#22AA88", shape: "wave" };
  const payload = `47:["$","$L5e",null,{"state":{"queries":[{"state":{"data":${JSON.stringify(data)}}}]}}]`;
  response.writeHead(200, { "content-type": "text/html" });
  response.end(`<html><head><meta property="og:url" content="https://x.ai/bot/${id}"/></head><body><script>self.__next_f.push([1,${JSON.stringify(payload)}])</script></body></html>`);
});
await new Promise((resolve) => grok.listen(0, "127.0.0.1", resolve));

const persist = await mkdtemp(join(tmpdir(), "squad-marketplace-browser-"));
const apiPort = await freePort();
let api = await startLocalMarketplace({ port: apiPort, persist });
// A person past onboarding has a default work folder; new members land there.
const bridge = await startBridge({ prepare: async (directory) => {
  const home = join(directory, "home"); await mkdir(home);
  return { HOME: home, USERPROFILE: home, AUTOHAND_SQUAD_API_URL: `http://127.0.0.1:${apiPort}`, AUTOHAND_SQUAD_GROK_ORIGIN: `http://127.0.0.1:${grok.address().port}` };
} });
assert.equal((await bridge.api("/api/workspaces/default", "POST", { consent: true })).success, true, "default work folder");
let browser;
const text = (selector) => browser.evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText || ""`);
const clickIn = (selector, label) => browser.evaluate(`(() => { const button = [...document.querySelectorAll(${JSON.stringify(`${selector} button, ${selector} a`)})].find((item) => item.innerText.trim() === ${JSON.stringify(label)} || item.getAttribute("aria-label") === ${JSON.stringify(label)}); if (!button) throw new Error("no " + ${JSON.stringify(label)}); button.click(); })()`);
// Radix opens on pointer events, so menus and selects get a real mouse press.
async function press(selector, label = "") {
  const box = await browser.evaluate(`(() => { const items = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((item) => !${JSON.stringify(label)} || item.innerText.trim() === ${JSON.stringify(label)}); const rect = items[0]?.getBoundingClientRect(); return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null; })()`);
  assert.ok(box, `nothing to press at ${selector} ${label}`);
  for (const type of ["mousePressed", "mouseReleased"]) await browser.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
}
const memberNames = async () => (await bridge.api("/api/marketplace/imports")).data.imports.map((entry) => entry.memberName);

try {
  const member = { id: "asq_quill_fixture", name: "Quill", role: "Release notes writer", description: "Writes release notes from merged changes.", instructions: "Act as a release notes writer. Read the merged changes and write notes people read.", workspace: process.cwd(), projects: [{ path: process.cwd() }], harness: { id: "autohand" }, permissions: {}, skills: [], avatar: "/avatars/birds/tui.webp" };
  browser = await startBrowser();
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await seedOwnedBrowserFixture(bridge, browser, { members: [member] });
  await browser.navigate(`${bridge.origin}/squad`);
  await until(() => browser.evaluate(`!!document.querySelector('[aria-label="Team actions"]')`), "directory overflow", 30000);

  // Explore -------------------------------------------------------------------
  await press('[aria-label="Team actions"]');
  await until(() => browser.evaluate(`!!document.querySelector('[data-testid=open-marketplace]')`), "Marketplace… in the overflow");
  await browser.evaluate(`document.querySelector('[data-testid=open-marketplace]').click()`);
  await until(() => browser.evaluate(`document.querySelectorAll('[data-testid=marketplace-featured] li').length >= 4`), "the first screen with Featured", 20000);
  assert.match(await text("[data-testid=marketplace-dialog]"), /All\s*371/);
  assert.match(await text("[data-testid=marketplace-section-engineering] li"), /by Autohand Squad team/);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await browser.screenshot(`${artifact}/explore.png`);
  await clickIn("[data-testid=marketplace-dialog]", "Finance36");
  await until(() => browser.evaluate(`[...document.querySelectorAll('[data-testid=marketplace-list] li')].length === 24 && document.querySelector('[data-testid=marketplace-list]').innerText.includes('Finance')`), "Finance category");
  await browser.fill('[data-testid=marketplace-search]', "payroll");
  await until(() => browser.evaluate(`[...document.querySelectorAll('[data-testid=marketplace-list] li')].some((row) => row.innerText.includes('Phoebe by Autohand Squad team')) && [...document.querySelectorAll('[data-testid=marketplace-list] li')].every((row) => /payroll/i.test(row.innerText) || row.dataset.kind === 'agent')`), "search finds Phoebe");
  await browser.screenshot(`${artifact}/search.png`);

  // An agent's page, then Add to squad ------------------------------------------------
  await clickIn("[data-testid=marketplace-list]", "View Phoebe");
  await until(() => browser.evaluate(`document.querySelector('[data-testid=marketplace-detail]')?.innerText.includes('payroll-run-bridge')`), "Phoebe's page with skills");
  const detail = await text("[data-testid=marketplace-dialog]");
  assert.match(detail, /Payroll variance checker · by Autohand Squad team/); assert.match(detail, /Added \d{1,2} \w{3} 20\d\d/); assert.match(detail, /Ask level with its skills switched off/);
  await browser.screenshot(`${artifact}/detail.png`);
  await browser.evaluate(`document.querySelector('[data-testid=marketplace-add]').click()`);
  await until(() => browser.evaluate(`!document.querySelector('[data-testid=marketplace-dialog]')`), "Add closes the dialog");
  await until(async () => (await memberNames()).includes("Phoebe"), "Phoebe joins the squad and is recorded", 60000);
  await until(() => browser.evaluate(`document.body.innerText.includes('Phoebe')`), "Phoebe in the directory", 30000);
  await browser.screenshot(`${artifact}/added.png`);

  // The deep-link route, with the listing's checksum: already here, so Add another ---------
  const phoebe = (await bridge.api("/api/marketplace/agents?q=payroll")).data.agents.find((agent) => agent.name === "Phoebe");
  await browser.navigate(`${bridge.origin}/marketplace/agents/${phoebe.id}?sha256=${phoebe.contentHash}`);
  await until(() => browser.evaluate(`document.querySelector('[data-testid=marketplace-existing]')?.innerText.includes('Already in your squad as Phoebe, at this version')`), "the link opens Phoebe and knows she is here", 30000);
  assert.equal(await browser.evaluate("location.pathname"), "/squad", "the route hands over to the directory");
  assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid=marketplace-update]')`), false, "no Update for the same version");
  await browser.screenshot(`${artifact}/deep-link-existing.png`);
  await browser.evaluate(`document.querySelector('[data-testid=marketplace-add]').click()`);
  await until(async () => (await memberNames()).filter((name) => name.startsWith("Phoebe")).length === 2, "Add another makes a second, numbered member", 60000);
  assert.ok((await memberNames()).includes("Phoebe 2"));

  // A link whose checksum is not the listed one is refused before anything is added -------
  await browser.navigate(`${bridge.origin}/marketplace/agents/${phoebe.id}?sha256=${"c".repeat(64)}`);
  await until(() => browser.evaluate(`document.querySelector('[data-testid=marketplace-error]')?.innerText.includes('different version')`), "a stale or tampered link is refused", 30000);
  assert.equal(await browser.evaluate(`document.querySelector('[data-testid=marketplace-add]').disabled`), true);
  await browser.screenshot(`${artifact}/deep-link-refused.png`);
  await press('[data-testid=marketplace-dialog] button', "Back");

  // A malformed route opens nothing ------------------------------------------------------
  await browser.navigate(`${bridge.origin}/marketplace/agents/${phoebe.id}?next=/settings`);
  await until(() => browser.evaluate(`location.pathname === "/squad" && !!document.querySelector('[aria-label="Team actions"]')`), "malformed route returns to the directory", 30000);
  assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid=marketplace-dialog]')`), false);

  // A Grok Bot link -------------------------------------------------------------------------
  await press('[aria-label="Team actions"]');
  await until(() => browser.evaluate(`!!document.querySelector('[data-testid=open-marketplace]')`), "overflow again");
  await browser.evaluate(`document.querySelector('[data-testid=open-marketplace]').click()`);
  await until(() => browser.evaluate(`!!document.querySelector('[data-testid=marketplace-dialog]')`), "dialog");
  await clickIn("[data-testid=marketplace-dialog]", "From a link");
  await browser.fill('[aria-label="Link"]', "https://x.ai/bot/FixtureBot0001");
  await clickIn("[data-testid=marketplace-dialog]", "Open");
  await until(() => browser.evaluate(`document.querySelector('[data-testid=marketplace-dialog]')?.innerText.includes('Grok Bot template by a Grok Bot user')`), "Grok Bot template page", 20000);
  assert.match(await text("[data-testid=marketplace-dialog]"), /not its instructions/);
  assert.match(await text("[data-testid=marketplace-third-party]"), /not by Autohand/);
  await browser.screenshot(`${artifact}/grok.png`);
  await browser.fill('[aria-label="Paste the bot\'s instructions (optional)"]', "You plan tides first and weather second.");
  await browser.evaluate(`document.querySelector('[data-testid=marketplace-add]').click()`);
  await until(async () => (await bridge.api("/api/marketplace/imports")).data.imports.some((entry) => entry.source === "grok" && entry.grokId === "FixtureBot0001"), "the Grok Bot agent is added and recorded", 60000);

  // Publish to marketplace from the member menu -------------------------------------------------
  await press('[aria-label="Actions for Quill"]');
  await until(() => browser.evaluate(`[...document.querySelectorAll('button')].some((button) => button.innerText.trim() === 'Publish to marketplace…')`), "Publish to marketplace… in the member menu");
  await browser.click("Publish to marketplace…");
  await until(() => browser.evaluate(`!!document.querySelector('#publish-tagline')`), "publish form", 20000);
  await browser.fill("#publish-tagline", "Turns merged changes into release notes people read.");
  await press("#publish-category");
  await until(() => browser.evaluate(`[...document.querySelectorAll('[role=option]')].some((option) => option.innerText.trim() === 'Engineering')`), "category options");
  await press("[role=option]", "Engineering");
  await browser.fill("#publish-creator", "Quill's maker");
  await until(() => browser.evaluate(`!document.querySelector('[data-testid=publish-submit]').disabled`), "Publish enabled");
  await browser.screenshot(`${artifact}/publish.png`);
  await browser.evaluate(`document.querySelector('[data-testid=publish-submit]').click()`);
  await until(() => browser.evaluate(`document.querySelector('[data-testid=published-link]')?.innerText.startsWith('https://autohand.ai/squad/marketplace/')`), "published with a link", 30000);
  await browser.screenshot(`${artifact}/published.png`);
  const listed = (await bridge.api("/api/marketplace/agents?q=quill&creator=user")).data.agents;
  assert.deepEqual(listed.map((agent) => [agent.name, agent.creator.name, agent.category]), [["Quill", "Quill's maker", "engineering"]]);
  await clickIn("[data-testid=publish-dialog]", "Done");
  await until(() => browser.evaluate(`!document.querySelector('[data-testid=publish-dialog]') && !document.querySelector('[role=dialog]')`), "the publish dialog closes");

  // Offline: the last list stays readable, and says so ---------------------------------------------
  await api.dispose();
  await press('[aria-label="Team actions"]');
  await until(() => browser.evaluate(`!!document.querySelector('[data-testid=open-marketplace]')`), "overflow offline");
  await browser.evaluate(`document.querySelector('[data-testid=open-marketplace]').click()`);
  await until(() => browser.evaluate(`!!document.querySelector('[data-testid=marketplace-offline]') && document.querySelectorAll('[data-testid=marketplace-featured] li').length > 0`), "offline: the last first screen", 30000);
  await browser.screenshot(`${artifact}/offline.png`);

  // The same at phone width, dark --------------------------------------------------------------
  api = await startLocalMarketplace({ port: apiPort, persist, seed: false });
  await browser.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await clickIn("[data-testid=marketplace-dialog]", "Retry");
  await until(() => browser.evaluate(`!document.querySelector('[data-testid=marketplace-offline]') && document.querySelectorAll('[data-testid=marketplace-featured] li').length >= 4`), "online again", 20000);
  assert.equal(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "no sideways scroll at phone width");
  await browser.screenshot(`${artifact}/explore-phone.png`);

  assert.deepEqual(browser.errors, []);
  console.log("PASS: Explore, search, an agent's page, Add to squad, the deep-link route with its checksum, Add another, a refused checksum, a Grok Bot link, Publish to marketplace and the offline list all work in the app.");
} catch (error) {
  await browser?.screenshot(`${artifact}/failure.png`).catch(() => {});
  console.error(await browser?.evaluate("document.body.innerText.slice(0, 3000)").catch(() => ""));
  console.error(bridge.logs.split("\n").filter((line) => /error|fail|marketplace|team/i.test(line)).slice(-40).join("\n"));
  throw error;
} finally {
  await browser?.close();
  await bridge.close();
  await api?.dispose().catch(() => {});
  grok.close();
  await rm(persist, { recursive: true, force: true });
}
