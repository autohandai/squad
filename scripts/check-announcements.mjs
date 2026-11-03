import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAnnouncements } from "../server/announcements.mjs";
import { startBridge } from "./lib/reliability-browser.mjs";

let credential = "fixture-only-no-provider", redirect = false, failed = false;
const calls = [];
const upstream = createServer(async (req, res) => {
  let body = ""; for await (const chunk of req) body += chunk;
  calls.push({ url: req.url, authorization: req.headers.authorization, body: body ? JSON.parse(body) : undefined });
  if (redirect) { res.writeHead(302, { location: "https://example.test/" }); res.end(); return; }
  if (failed) { res.writeHead(503); res.end(); return; }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(req.method === "GET" ? { announcements: [{ id: "squad-news", title: "News", description: "A Squad update.", placement: "modal", ctaUrl: "javascript:alert(1)", steps: [{ type: "image", mediaUrl: "https://media.autohand.ai/squad.png", ctaUrl: "file:///private" }] }] } : { ok: true }));
});
await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${upstream.address().port}`;
let bridge;
try {
  const service = createAnnouncements({ token: () => credential, version: "0.1.16", platform: "darwin", baseUrl: origin });
  const result = await service.list();
  assert.equal(result.announcements[0].ctaUrl, "");
  assert.equal(result.announcements[0].steps[0].ctaUrl, "");
  assert.equal(calls[0].authorization, `Bearer ${credential}`);
  const query = new URL(calls[0].url, origin);
  assert.equal(query.searchParams.get("clientType"), "squad");
  assert.equal(query.searchParams.get("appVersion"), "0.1.16");
  assert.equal(query.searchParams.get("platform"), "macos");
  assert(!JSON.stringify(result).includes(credential));
  await service.act("squad-news", "seen", 2);
  assert.deepEqual(calls.at(-1).body, { lastStep: 2 });
  await assert.rejects(service.act("../escape", "dismiss"), /Invalid/);
  credential = "";
  const before = calls.length; assert.deepEqual(await service.list(), { announcements: [] }); assert.equal(calls.length, before);
  credential = "fixture-only-no-provider";
  redirect = true; await assert.rejects(service.list()); redirect = false;
  const changing = createAnnouncements({ token: () => credential, version: "0.1.16", baseUrl: origin, fetchImpl: async () => { credential = "other-account"; return Response.json({ announcements: [] }); } });
  await assert.rejects(changing.list(), /account changed/);

  bridge = await startBridge({ prepare: async () => ({ AUTOHAND_API_URL: origin }) });
  const feed = await bridge.api("/api/announcements");
  assert.equal(feed.status, 200); assert.equal(feed.data.announcements[0].title, "News");
  const seen = await bridge.api("/api/announcements/squad-news/seen", "POST", { lastStep: 1 });
  assert.equal(seen.status, 200); assert.equal(calls.at(-1).body.lastStep, 1);
  failed = true;
  assert.equal((await bridge.api("/api/announcements/squad-news/dismiss", "POST", {})).status, 502);
  failed = false;
  assert.equal((await bridge.api("/api/announcements/squad-news/dismiss", "POST", {})).data.ok, true);
  await writeFile(join(bridge.directory, "config.json"), "{}");
  assert.deepEqual((await bridge.api("/api/announcements")).data.announcements, []);
  console.log("PASS real bridge feed/seen/dismiss, Squad/version/platform targeting, server-only auth, account changes/sign-out, safe URLs, redirect refusal and failed-dismiss retry. Upstream API fixture only.");
} finally { await bridge?.close(); await new Promise(resolve => upstream.close(resolve)); }
