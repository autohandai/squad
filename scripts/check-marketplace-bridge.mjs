#!/usr/bin/env node
// The agent marketplace through a real bridge (ADR-0246): the local Squad API
// (workerd, D1, the 200 seeds) and a loopback stand-in for x.ai. Browsing,
// verified template fetches, checksum refusals, offline fallback, receipts,
// Grok Bot previews and their limits, and publishing with the signed-in
// fixture account, including secret refusal, versions and unpublishing.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startBridge } from "./lib/reliability-browser.mjs";
import { startLocalMarketplace } from "../services/squad-api/scripts/local-marketplace.mjs";
import { contentHash, newAttributionId, validateAgentTemplate, validateTeamTemplate } from "../src/lib/marketplace.js";
import { LOCAL_ADMIN_TOKEN } from "../services/squad-api/scripts/local-marketplace.mjs";

const freePort = () => new Promise((resolve) => { const server = createServer(); server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); }); });

// x.ai stand-in: one bot page with the observed structure, a redirect, a 404.
const grokRequests = [];
const grok = createServer((request, response) => {
  grokRequests.push({ url: request.url, agent: request.headers["user-agent"], cookie: request.headers.cookie || "" });
  const id = request.url.replace(/^\/bot\//, "");
  if (id === "RedirectingBot1") { response.writeHead(302, { location: "https://evil.example/" }); response.end(); return; }
  if (!id.startsWith("FixtureBot")) { response.writeHead(404); response.end("not found"); return; }
  const data = { id, ownerType: "USER", sharerName: id === "FixtureBotNamed" ? "Mere" : null, botName: "tide clock", description: "Plans a fishing day around tides and weather.", addHref: `grokbot://app/v1/bot-template?id=${id}`, color: "#22AA88", shape: "wave" };
  const payload = `47:["$","$L5e",null,{"state":{"queries":[{"state":{"data":${JSON.stringify(data)}}}]}}]`;
  response.writeHead(200, { "content-type": "text/html" });
  response.end(`<html><head><meta property="og:url" content="https://x.ai/bot/${id}"/><meta property="og:title" content="tide clock"/></head><body><script>self.__next_f.push([1,${JSON.stringify(payload)}])</script></body></html>`);
});
await new Promise((resolve) => grok.listen(0, "127.0.0.1", resolve));
const grokOrigin = `http://127.0.0.1:${grok.address().port}`;

const persist = await mkdtemp(join(tmpdir(), "squad-marketplace-api-"));
const apiPort = await freePort();
let api = await startLocalMarketplace({ port: apiPort, persist });
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const bridge = await startBridge({ prepare: async () => ({ AUTOHAND_SQUAD_API_URL: apiOrigin, AUTOHAND_SQUAD_GROK_ORIGIN: grokOrigin }) });
const call = (path, method = "GET", body) => bridge.api(path, method, body, 30000);

try {
  // Browsing ------------------------------------------------------------------
  const categories = await call("/api/marketplace/categories");
  assert.equal(categories.success, true, JSON.stringify(categories));
  assert.equal(categories.data.total, 350); assert.equal(categories.data.teams, 21); assert.equal(categories.data.offline, false);
  const home = await call("/api/marketplace/home");
  assert.equal(home.success, true, JSON.stringify(home));
  assert.equal(home.data.featured[0].name, "Abner"); assert.equal(home.data.sections.length, 10);
  assert.ok(home.data.teams.every((item) => item.kind === "team" && item.faces.length >= 2));
  assert.equal((await call("/api/marketplace/agents?kind=team&limit=50")).data.total, 21);
  const payroll = await call("/api/marketplace/agents?q=payroll");
  const phoebe = payroll.data.agents.find((agent) => agent.name === "Phoebe");
  assert.ok(phoebe, "search finds Phoebe");
  const detail = await call(`/api/marketplace/agents/${phoebe.id}`);
  assert.match(detail.data.preview.instructions, /payroll/i);
  assert.equal((await call("/api/marketplace/agents/NOT-AN-ID")).status, 404);

  // Verified templates ------------------------------------------------------------
  const fetched = await call("/api/marketplace/fetch", "POST", { id: phoebe.id });
  assert.equal(fetched.success, true, JSON.stringify(fetched));
  assert.ok(validateAgentTemplate(fetched.data.document).ok);
  assert.equal(fetched.data.contentHash, await contentHash(fetched.data.document));
  assert.equal(fetched.data.contentHash, phoebe.contentHash);
  assert.deepEqual(fetched.data.existing, []);
  const tampered = await call("/api/marketplace/fetch", "POST", { id: phoebe.id, sha256: "b".repeat(64) });
  assert.equal(tampered.status, 409); assert.equal(tampered.code, "template_mismatch"); assert.match(tampered.error, /nothing was added/);
  assert.equal((await call("/api/marketplace/fetch", "POST", { id: phoebe.id, sha256: "nope" })).code, "link_invalid");
  assert.equal((await call("/api/marketplace/fetch", "POST", { id: "zzzzzzzzzzzz" })).status, 404);

  // A whole team: verified as a team template, refused by nothing else.
  const desk = home.data.teams.find((item) => item.name === "Code review desk");
  const teamFetch = await call("/api/marketplace/fetch", "POST", { id: desk.id, sha256: desk.contentHash });
  assert.equal(teamFetch.success, true, JSON.stringify(teamFetch));
  assert.equal(teamFetch.data.kind, "team");
  assert.ok(validateTeamTemplate(teamFetch.data.document).ok);
  assert.equal(teamFetch.data.document.members.length, 4);
  assert.equal(teamFetch.data.contentHash, await contentHash(teamFetch.data.document));

  // Pasted links ----------------------------------------------------------------
  assert.deepEqual((await call("/api/marketplace/resolve", "POST", { link: `https://autohand.ai/squad/marketplace/${phoebe.id}` })).data, { kind: "marketplace", listing: "agent", id: phoebe.id });
  assert.equal((await call("/api/marketplace/resolve", "POST", { link: "https://evil.example/squad/marketplace/abcdefgh1234" })).data.kind, "invalid");

  // Receipts: only for members still in the squad ---------------------------------------
  const member = { id: "member-quill-0001", name: "Quill", role: "Release notes writer", description: "Writes release notes.", instructions: "Act as a release notes writer. Read the merged changes and write notes people read.", brainCard: { purpose: "Write release notes." }, skills: [], avatar: "/avatars/birds/tui.webp" };
  assert.equal((await bridge.api(`/api/members/${member.id}/channel-access`, "PUT", { agent: member, profile: "", profilePatch: {} })).success, true);
  assert.equal((await call("/api/marketplace/imports", "POST", { source: "marketplace", listingId: "bad", memberId: member.id })).status, 400);
  assert.equal((await call("/api/marketplace/imports", "POST", { source: "marketplace", listingId: phoebe.id, version: 1, contentHash: phoebe.contentHash, memberId: member.id, creator: "Autohand Squad team" })).status, 201);
  assert.equal((await call("/api/marketplace/imports", "POST", { source: "marketplace", listingId: phoebe.id, version: 1, contentHash: phoebe.contentHash, memberId: "member-gone-0001" })).status, 201);
  const receipts = (await call("/api/marketplace/imports")).data.imports;
  assert.equal(receipts.length, 1, "a receipt for a member that does not exist is dropped");
  assert.equal(receipts[0].memberName, "Quill");
  assert.equal((await call("/api/marketplace/fetch", "POST", { id: phoebe.id })).data.existing[0].memberId, member.id, "a second add sees the first");

  // A confirmed install is counted by the API, joined to the website click by its attribution id.
  const admin = async (path) => (await fetch(`${apiOrigin}${path}`, { headers: { authorization: `Bearer ${LOCAL_ADMIN_TOKEN}`, "x-marketplace-admin": "check@autohand.example" } })).json();
  const attribution = newAttributionId();
  const click = await fetch(`${apiOrigin}/v1/marketplace/agents/${desk.id}/events`, { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" }, body: JSON.stringify({ type: "add_click", source: "website", attribution }) });
  assert.equal(click.status, 202);
  const second = { ...member, id: "member-alder-0001", name: "Alder" };
  assert.equal((await bridge.api(`/api/members/${second.id}/channel-access`, "PUT", { agent: second, profile: "", profilePatch: {} })).success, true);
  const teamReceipt = await call("/api/marketplace/imports", "POST", { source: "marketplace", kind: "team", listingId: desk.id, version: 1, contentHash: desk.contentHash, memberId: second.id, memberIds: [second.id, member.id], via: "website-link", attribution, creator: "Autohand Squad team" });
  assert.equal(teamReceipt.status, 201, JSON.stringify(teamReceipt));
  assert.equal(teamReceipt.data.kind, "team"); assert.deepEqual(teamReceipt.data.memberIds, [second.id, member.id]); assert.equal(teamReceipt.data.attribution, undefined, "the attribution id is not kept on this machine");
  let stats;
  for (let tries = 0; tries < 20; tries += 1) {
    stats = (await admin(`/v1/marketplace/admin/agents?kind=team&q=code%20review%20desk`)).data.agents.find((item) => item.id === desk.id).stats;
    if (stats.installs) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.deepEqual({ installs: stats.installs, attributedInstalls: stats.attributedInstalls, addClicks: stats.addClicks }, { installs: 1, attributedInstalls: 1, addClicks: 1 });
  const listed = (await call("/api/marketplace/imports")).data.imports.find((entry) => entry.listingId === desk.id);
  assert.equal(listed.memberName, "Alder"); assert.deepEqual(listed.memberIds, [second.id, member.id]);

  // Grok Bot templates ----------------------------------------------------------------
  const preview = await call("/api/marketplace/grok/preview", "POST", { url: "https://x.ai/bot/FixtureBot0001" });
  assert.equal(preview.success, true, JSON.stringify(preview));
  assert.equal(preview.data.bot.name, "tide clock"); assert.equal(preview.data.creator, "a Grok Bot user");
  assert.equal(preview.data.sourceUrl, "https://x.ai/bot/FixtureBot0001");
  assert.ok(validateAgentTemplate(preview.data.document).ok);
  assert.match(grokRequests[0].agent, /^AutohandSquad\/.+\(user-initiated template import\)$/); assert.equal(grokRequests[0].cookie, "");
  const pasted = await call("/api/marketplace/grok/preview", "POST", { url: "grokbot://app/v1/bot-template?id=FixtureBot0001", instructions: "You plan tides first." });
  assert.match(pasted.data.document.members[0].instructions, /^You plan tides first/);
  assert.equal(grokRequests.length, 1, "the second preview of one bot is served from the cache");
  assert.equal((await call("/api/marketplace/grok/preview", "POST", { url: "https://x.ai/bot/FixtureBotNamed" })).data.creator, "Mere");
  assert.equal((await call("/api/marketplace/grok/preview", "POST", { url: "https://x.ai/bot/RedirectingBot1" })).code, "grok_redirect");
  assert.equal((await call("/api/marketplace/grok/preview", "POST", { url: "https://x.ai/bot/MissingBot001" })).code, "grok_not_found");
  assert.equal((await call("/api/marketplace/grok/preview", "POST", { url: "https://evil.example/bot/FixtureBot0002" })).code, "link_invalid");
  const burst = [];
  for (let index = 0; index < 5; index += 1) burst.push((await call("/api/marketplace/grok/preview", "POST", { url: `https://x.ai/bot/FixtureBot10${index}` })).status);
  assert.equal(burst.at(-1), 429, `six fetches a minute: ${burst}`);
  assert.ok(grokRequests.every((request) => request.url.startsWith("/bot/")), "only bot pages are fetched");

  // Publishing ---------------------------------------------------------------------------
  const context = await call("/api/marketplace/publish/context");
  assert.equal(context.success, true, JSON.stringify(context));
  assert.equal(context.data.signedIn, true);
  assert.deepEqual(context.data.owners.map((owner) => owner.kind), ["user", "team"]);
  const leaky = await call("/api/marketplace/publish/preview", "POST", { member: { ...member, instructions: "Deploy with api_key=abcd1234efgh5678 then write notes." } });
  assert.match(leaky.data.error, /members\[0\]\.instructions/); assert.equal(leaky.data.findings[0].path, "members[0].instructions");
  const listing = { tagline: "Turns merged changes into release notes people read.", description: "", category: "engineering", tags: ["release"] };
  const refused = await call("/api/marketplace/publish", "POST", { member: { ...member, instructions: "Deploy with api_key=abcd1234efgh5678 then write notes." }, listing });
  assert.equal(refused.code, "template_secrets");
  const published = await call("/api/marketplace/publish", "POST", { member, listing, requestId: "publish-quill-0001", note: "First" });
  assert.equal(published.status, 201, JSON.stringify(published));
  const quill = published.data.agent;
  assert.equal(quill.creator.kind, "user"); assert.equal(quill.version, 1);
  const again = await call("/api/marketplace/publish", "POST", { member, listing, requestId: "publish-quill-0001", note: "First" });
  assert.equal(again.data.agent.id, quill.id, "a retried publish is the same listing");
  assert.ok((await call("/api/marketplace/agents?q=quill")).data.agents.some((agent) => agent.id === quill.id));
  const team = await call("/api/marketplace/publish", "POST", { member: { ...member, name: "Kahu" }, listing, owner: { kind: "team", id: "team-kahu" }, requestId: "publish-kahu-0001" });
  assert.equal(team.data.agent.creator.name, "Kahu Studio", JSON.stringify(team));
  const v2 = await call("/api/marketplace/publish", "POST", { member: { ...member, instructions: `${member.instructions} Keep each note to two lines.` }, listing, listingId: quill.id, baseVersion: 1, requestId: "publish-quill-0002" });
  assert.equal(v2.data.agent.version, 2, JSON.stringify(v2));
  assert.equal((await call("/api/marketplace/publish", "POST", { member, listing, listingId: quill.id, baseVersion: 1, requestId: "publish-quill-0003" })).code, "version_conflict");
  const mine = await call("/api/marketplace/mine");
  assert.deepEqual(mine.data.agents.map((agent) => agent.id).sort(), [quill.id, team.data.agent.id].sort());
  assert.equal((await call(`/api/marketplace/agents/${quill.id}`, "DELETE")).data.status, "unpublished");
  assert.equal((await call(`/api/marketplace/agents/${quill.id}`)).status, 404);
  assert.equal((await call(`/api/marketplace/agents/${phoebe.id}/report`, "POST", { reason: "broken", details: "Fixture report" })).status, 202);

  // Offline: the last list stays readable; a template never comes from a cache ------
  await api.dispose();
  const offline = await call("/api/marketplace/agents?q=payroll");
  assert.equal(offline.success, true); assert.equal(offline.data.offline, true);
  assert.ok(offline.data.agents.some((agent) => agent.name === "Phoebe"));
  const cold = await call("/api/marketplace/agents?q=never-searched");
  assert.equal(cold.status, 503); assert.equal(cold.code, "marketplace_offline");
  const noTemplate = await call("/api/marketplace/fetch", "POST", { id: phoebe.id });
  assert.equal(noTemplate.status, 503); assert.match(noTemplate.error, /nothing was added/);
  api = await startLocalMarketplace({ port: apiPort, persist, seed: false });
  const online = await call("/api/marketplace/agents?q=payroll");
  assert.equal(online.data.offline, false, "back online");
  assert.ok(online.data.agents.some((agent) => agent.name === "Phoebe"), "the local API's D1 survives a restart");
  console.log("check-marketplace-bridge: browsing, home and teams, verified fetches, offline, receipts, install events with attribution, Grok previews and publishing OK");
} finally {
  await bridge.close().catch(() => {});
  await api?.dispose().catch(() => {});
  grok.close();
  await rm(persist, { recursive: true, force: true });
}
