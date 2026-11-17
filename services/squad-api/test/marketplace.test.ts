// The agent marketplace (ADR-0246) in workerd with real D1: the 200 seeds,
// public browsing and caching, verified templates, publishing with
// idempotency, versions and team authority, reports, admin moderation and
// the audit trail. Only the Autohand identity provider is a fixture.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { contentHash, validateAgentTemplate } from "../../../src/lib/marketplace.js";
import { readSeeds, seedStatements, seedTemplates } from "../scripts/marketplace-seed.mjs";

let runtime: Miniflare; let alice = ""; let bob = ""; let carol = "";
const ADMIN = "fixture-marketplace-admin-credential-0123456789";
type Json = { success: boolean; data: any; error?: { code: string; message: string; details?: unknown } };
async function call(path: string, { method = "GET", value, session, identity, key, ip = "198.51.100.1", headers = {} }: { method?: string; value?: unknown; session?: string; identity?: string; key?: string; ip?: string; headers?: Record<string, string> } = {}) {
  const response = await runtime.dispatchFetch(`https://squad.example.test${path}`, { method,
    headers: { "cf-connecting-ip": ip, ...(session ? { authorization: `Bearer ${session}` } : {}), ...(identity ? { "x-autohand-identity": identity } : {}), ...(value === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}), ...headers },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, json: (text ? JSON.parse(text) : null) as Json };
}
const adminCall = (path: string, options: Parameters<typeof call>[1] = {}) => call(path, { ...options, headers: { authorization: `Bearer ${ADMIN}`, "x-marketplace-admin": "moderator@autohand.example", ...(options.headers || {}) } });

const skill = { name: "release-checklist", description: "Checks a release against a short list.", text: "---\nname: release-checklist\ndescription: Checks a release against a short list.\n---\n\n# Release checklist\n\n1. Read the change list.\n2. Confirm each item has a test.\n" };
function document(name = "Quill", extra: Record<string, unknown> = {}) {
  return {
    format: "autohand.squad-team", version: 1, kind: "team",
    team: { name, description: "Writes release notes from merged changes.", lead: name, exportedAt: "", app: "" },
    members: [{ key: name.toLowerCase(), name, role: "Release notes writer", description: "Writes release notes.", instructions: "Act as a release notes writer. Read the merged changes and write notes for users.", brainCard: { purpose: "Write release notes." }, look: { avatar: "/avatars/birds/tui.webp", employeeType: "" }, skills: ["release-checklist"], harness: { id: "autohand" }, ...extra }],
    skills: [skill], channels: [], workflows: [], presets: [], routines: [], connectors: [],
  };
}
const listing = { tagline: "Turns merged pull requests into release notes people read.", description: "Groups changes by audience.", category: "engineering", tags: ["release", "writing"] };

before(async () => {
  const bundle = await build({ entryPoints: ["src/index.ts"], bundle: true, write: false, format: "esm", platform: "browser", target: "es2024", external: ["cloudflare:workers"] });
  runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "squad-api", modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-10-27",
    d1Databases: ["DB", "MARKETPLACE"], r2Buckets: ["MEMORY", "RELEASES"],
    bindings: { IDENTITY_ORIGIN: "https://api.autohand.ai", WEB_ORIGIN: "https://squad.example.test", RELEASE_PUBLISHER_TOKEN: "not-used", MARKETPLACE_ADMIN_TOKEN: ADMIN },
    outboundService: "identity",
  }, { name: "identity", modules: true, compatibilityDate: "2026-10-27", script: `export default { async fetch(request) {
      const url = new URL(request.url);
      const who = request.headers.get('authorization')?.replace('Bearer identity-', '');
      if (!['alice','bob','carol'].includes(who)) return Response.json({success:false}, {status:401});
      const names = { alice: 'Alice Moana', bob: 'Bob', carol: null };
      if (url.pathname === '/v1/profile') return Response.json({success:true,profile:{id:'identity_'+who,email:who+'@example.test',name:names[who],status:'active'}});
      if (url.pathname === '/v1/accounts') return Response.json({success:true,accounts:[
        {account:{id:'personal-'+who,name:who,type:'personal',accessMode:'full',status:'active'},role:'owner',permissions:['resources:operate']},
        ...(who==='carol'?[]:[{account:{id:'team-kahu',name:'Kahu Studio',type:'team',accessMode:'full',status:'active'},role:who==='alice'?'owner':'contributor',permissions:['resources:operate']}])
      ]});
      return Response.json({success:false},{status:404});
    }};` }] }));
  const db = await runtime.getD1Database("DB", "squad-api");
  for (const name of (await readdir("migrations")).filter(name => name.endsWith(".sql")).sort()) {
    const sql = await readFile(`migrations/${name}`, "utf8");
    await db.batch(sql.split(";").filter(part => part.trim()).map(part => db.prepare(part)));
  }
  const market = await runtime.getD1Database("MARKETPLACE", "squad-api");
  const schema = await readFile("marketplace-migrations/0001_marketplace.sql", "utf8");
  await market.batch(schema.split(";").filter(part => part.replace(/--.*$/gm, "").trim()).map(part => market.prepare(part)));
  const statements = seedStatements(await seedTemplates(await readSeeds()), "2026-11-17T09:00:00.000Z");
  for (let index = 0; index < statements.length; index += 50) await market.batch(statements.slice(index, index + 50).map(({ sql, params }) => market.prepare(sql).bind(...params)));
  const session = async (who: string) => String((await call("/v1/auth/exchange", { method: "POST", value: { identityToken: `identity-${who}`, deviceName: who } })).json.data.token);
  alice = await session("alice"); bob = await session("bob"); carol = await session("carol");
});
after(async () => { await runtime?.dispose(); });

test("the 200 Autohand seeds are browsable by category, creator and search, with stable pagination", async () => {
  const categories = await call("/v1/marketplace/categories");
  assert.equal(categories.json.data.total, 200);
  assert.equal(categories.json.data.autohand, 200);
  assert(categories.json.data.categories.every((category: { count: number }) => category.count === 20), JSON.stringify(categories.json.data.categories));
  const seen = new Set<string>(); let cursor = ""; let pages = 0;
  do {
    const page = await call(`/v1/marketplace/agents?limit=37${cursor ? `&cursor=${cursor}` : ""}`);
    assert.equal(page.status, 200); assert.equal(page.json.data.total, 200);
    for (const agent of page.json.data.agents) { assert(!seen.has(agent.id), `duplicate ${agent.id}`); seen.add(agent.id); }
    cursor = page.json.data.nextCursor || ""; pages += 1;
  } while (cursor && pages < 20);
  assert.equal(seen.size, 200);
  const first = (await call("/v1/marketplace/agents?limit=1")).json.data.agents[0];
  assert.deepEqual(Object.keys(first.creator), ["kind", "name"]);
  assert.equal(first.creator.name, "Autohand Squad team"); assert.equal(first.createdAt, "2026-11-17T09:00:00.000Z");
  assert.equal((await call("/v1/marketplace/agents?category=finance&limit=50")).json.data.total, 20);
  assert.equal((await call("/v1/marketplace/agents?q=autohand%20squad%20team")).json.data.total, 200);
  const flaky = await call("/v1/marketplace/agents?q=flaky");
  assert(flaky.json.data.agents.some((agent: { name: string }) => agent.name === "Cedric"));
  assert.equal((await call("/v1/marketplace/agents?q=%25")).json.data.total, 0, "LIKE wildcards are literal");
  assert.equal((await call("/v1/marketplace/agents?category=astrology")).status, 400);
  assert.equal((await call("/v1/marketplace/agents?cursor=not-a-cursor")).status, 400);
});

test("public reads are cacheable, cross-origin readable and revalidate with ETags", async () => {
  const id = (await call("/v1/marketplace/agents?q=flaky")).json.data.agents[0].id;
  const detail = await call(`/v1/marketplace/agents/${id}`, { headers: { origin: "https://autohand.ai" } });
  assert.equal(detail.status, 200);
  assert.match(detail.headers.get("cache-control") || "", /public, max-age=60/);
  assert.equal(detail.headers.get("access-control-allow-origin"), "*");
  assert(detail.json.data.preview.instructions.includes("nondeterministic"));
  assert(detail.json.data.preview.skills.length >= 1);
  const etag = detail.headers.get("etag") || "";
  assert.equal((await call(`/v1/marketplace/agents/${id}`, { headers: { "if-none-match": etag } })).status, 304);
  assert.equal((await call("/v1/marketplace/agents/zzzzzzzzzzzz")).status, 404);
  assert.equal((await call("/v1/marketplace/agents/../me")).status, 401, "a dot-segment path reaches no public route");
  // A browser on another origin may read, never write.
  assert.equal((await call("/v1/marketplace/agents", { method: "POST", value: {}, headers: { origin: "https://evil.example" } })).status, 403);
});

test("a template downloads with a hash that recomputes, counts one add per network and is rate limited", async () => {
  const id = (await call("/v1/marketplace/agents?q=payroll")).json.data.agents[0].id;
  const fetched = await call(`/v1/marketplace/agents/${id}/template`, { ip: "203.0.113.7" });
  assert.equal(fetched.status, 200, JSON.stringify(fetched.json));
  assert.equal(fetched.headers.get("cache-control"), "no-store");
  const valid = validateAgentTemplate(fetched.json.data.document);
  assert(valid.ok);
  assert.equal(await contentHash(valid.document), fetched.json.data.contentHash);
  assert.equal(fetched.json.data.contentHash, fetched.json.data.agent.contentHash);
  await call(`/v1/marketplace/agents/${id}/template`, { ip: "203.0.113.7" });
  await call(`/v1/marketplace/agents/${id}/template`, { ip: "203.0.113.8" });
  assert.equal((await call(`/v1/marketplace/agents/${id}`)).json.data.agent.adds, 2);
  assert.equal((await call(`/v1/marketplace/agents/${id}/template?version=2`, { ip: "203.0.113.9" })).status, 400);
  const responses = [];
  for (let index = 0; index < 61; index += 1) responses.push((await call(`/v1/marketplace/agents/${id}/template`, { ip: "203.0.113.50" })).status);
  assert.equal(responses.filter(status => status === 200).length, 60);
  assert.equal(responses.at(-1), 429);
  // A corrupted stored document is refused, never served.
  const market = await runtime.getD1Database("MARKETPLACE", "squad-api");
  await market.prepare("UPDATE listing_versions SET document=replace(document,'nondeterministic','deterministic') WHERE listing_id=(SELECT id FROM listings WHERE name='Cedric')").run();
  const cedric = (await call("/v1/marketplace/agents?q=flaky")).json.data.agents[0].id;
  assert.equal((await call(`/v1/marketplace/agents/${cedric}/template`, { ip: "203.0.113.60" })).json.error?.code, "template_integrity");
});

test("publishing validates, refuses secrets, replays a retried key and keeps every version", async () => {
  assert.equal((await call("/v1/marketplace/agents", { method: "POST", value: { owner: { kind: "user" }, listing, document: document() } })).status, 401);
  assert.equal((await call("/v1/marketplace/agents", { method: "POST", session: alice, value: { owner: { kind: "user" }, listing, document: document() } })).json.error?.code, "idempotency_required");
  const leaky = await call("/v1/marketplace/agents", { method: "POST", session: alice, key: "leak", value: { owner: { kind: "user" }, listing, document: document("Quill", { notes: "Deploy with api_key=abcd1234efgh" }) } });
  assert.equal(leaky.json.error?.code, "template_secrets"); assert.match(leaky.json.error?.message || "", /members\[0\]\.notes/);
  const twoMembers = document(); twoMembers.members.push({ ...twoMembers.members[0], key: "b", name: "Other" });
  assert.equal((await call("/v1/marketplace/agents", { method: "POST", session: alice, key: "two", value: { owner: { kind: "user" }, listing, document: twoMembers } })).json.error?.code, "template_invalid");
  const withChannel = { ...document(), channels: [{ name: "general", visibility: "public", section: "", members: [] }] };
  assert.equal((await call("/v1/marketplace/agents", { method: "POST", session: alice, key: "chan", value: { owner: { kind: "user" }, listing, document: withChannel } })).json.error?.code, "template_invalid");
  assert.equal((await call("/v1/marketplace/agents", { method: "POST", session: alice, key: "cat", value: { owner: { kind: "user" }, listing: { ...listing, category: "astrology" }, document: document() } })).json.error?.code, "listing_invalid");
  assert.equal((await call("/v1/marketplace/agents", { method: "POST", session: carol, key: "nameless", value: { owner: { kind: "user" }, listing, document: document() } })).json.error?.code, "creator_name_required");
  assert.equal((await call("/v1/marketplace/agents", { method: "POST", session: carol, key: "email", value: { owner: { kind: "user" }, creatorName: "carol@example.test", listing, document: document() } })).json.error?.code, "creator_name_required");

  const created = await call("/v1/marketplace/agents", { method: "POST", session: alice, key: "quill-1", value: { owner: { kind: "user" }, listing, document: document(), note: "First version" } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const agent = created.json.data.agent;
  assert.equal(agent.creator.name, "Alice Moana"); assert.equal(agent.creator.kind, "user"); assert.equal(agent.version, 1); assert.equal(agent.bird, "tui");
  assert(!JSON.stringify(created.json).includes("alice@example.test"));
  const replay = await call("/v1/marketplace/agents", { method: "POST", session: alice, key: "quill-1", value: { owner: { kind: "user" }, listing, document: document(), note: "First version" } });
  assert.equal(replay.status, 200); assert.equal(replay.json.data.agent.id, agent.id);
  assert.equal((await call("/v1/marketplace/agents", { method: "POST", session: alice, key: "quill-1", value: { owner: { kind: "user" }, listing: { ...listing, tagline: "Different tagline for the same key." }, document: document() } })).json.error?.code, "idempotency_conflict");
  assert((await call("/v1/marketplace/agents?q=moana")).json.data.agents.some((item: { id: string }) => item.id === agent.id));

  const changed = document(); changed.members[0].instructions += " Keep each note under two lines.";
  assert.equal((await call(`/v1/marketplace/agents/${agent.id}`, { method: "PUT", session: bob, key: "steal", value: { baseVersion: 1, listing, document: changed } })).status, 404, "another person cannot change it");
  assert.equal((await call(`/v1/marketplace/agents/${agent.id}`, { method: "PUT", session: alice, key: "stale", value: { baseVersion: 2, listing, document: changed } })).json.error?.code, "version_conflict");
  const updated = await call(`/v1/marketplace/agents/${agent.id}`, { method: "PUT", session: alice, key: "quill-2", value: { baseVersion: 1, listing, document: changed, note: "Shorter notes" } });
  assert.equal(updated.status, 200, JSON.stringify(updated.json)); assert.equal(updated.json.data.agent.version, 2);
  const detail = await call(`/v1/marketplace/agents/${agent.id}`);
  assert.deepEqual(detail.json.data.versions.map((version: { version: number }) => version.version), [2, 1]);
  const old = await call(`/v1/marketplace/agents/${agent.id}/template?version=1`, { ip: "192.0.2.10" });
  assert.equal(old.json.data.version, 1); assert(!old.json.data.document.members[0].instructions.includes("two lines"));

  assert.equal((await call(`/v1/marketplace/agents/${agent.id}`, { method: "DELETE", session: alice })).json.data.status, "unpublished");
  assert.equal((await call(`/v1/marketplace/agents/${agent.id}`)).status, 404);
  const mine = await call("/v1/marketplace/mine", { session: alice });
  assert.equal(mine.json.data.agents.find((item: { id: string }) => item.id === agent.id)?.status, "unpublished");
  const republished = await call(`/v1/marketplace/agents/${agent.id}`, { method: "PUT", session: alice, key: "quill-3", value: { baseVersion: 2, listing, document: changed, note: "Back" } });
  assert.equal(republished.json.data.agent.version, 3);
  assert.equal((await call(`/v1/marketplace/agents/${agent.id}`)).status, 200);
});

test("team publishing needs a current owner or admin with write access", async () => {
  assert.equal((await call("/v1/marketplace/agents", { method: "POST", session: alice, key: "team-1", value: { owner: { kind: "team", id: "team-kahu" }, listing, document: document("Kahu") } })).json.error?.code, "identity_required");
  const team = await call("/v1/marketplace/agents", { method: "POST", session: alice, identity: "identity-alice", key: "team-1", value: { owner: { kind: "team", id: "team-kahu" }, listing, document: document("Kahu") } });
  assert.equal(team.status, 201, JSON.stringify(team.json)); assert.deepEqual(team.json.data.agent.creator, { kind: "team", name: "Kahu Studio" });
  assert.equal((await call("/v1/marketplace/agents", { method: "POST", session: bob, identity: "identity-bob", key: "team-2", value: { owner: { kind: "team", id: "team-kahu" }, listing, document: document("Bobby") } })).json.error?.code, "team_publish_forbidden");
  assert.equal((await call("/v1/marketplace/agents", { method: "POST", session: bob, identity: "identity-alice", key: "team-3", value: { owner: { kind: "team", id: "team-kahu" }, listing, document: document("Mixed") } })).json.error?.code, "identity_mismatch");
  assert.equal((await call("/v1/marketplace/agents", { method: "POST", session: carol, identity: "identity-carol", key: "team-4", value: { owner: { kind: "team", id: "team-kahu" }, listing, document: document("Outsider") } })).status, 404);
  assert.equal((await call(`/v1/marketplace/agents/${team.json.data.agent.id}`, { method: "DELETE", session: bob, identity: "identity-bob" })).json.error?.code, "team_publish_forbidden");
  const mine = await call("/v1/marketplace/mine", { session: alice, identity: "identity-alice" });
  assert(mine.json.data.agents.some((item: { id: string }) => item.id === team.json.data.agent.id));
});

test("publishing is rate limited per person", async () => {
  const statuses = [];
  for (let index = 0; index < 6; index += 1) statuses.push((await call("/v1/marketplace/agents", { method: "POST", session: bob, key: `burst-${index}`, value: { owner: { kind: "user" }, listing, document: document(`Burst${"abcdef"[index]}`) } })).status);
  assert.deepEqual(statuses.slice(0, 5), [201, 201, 201, 201, 201]); assert.equal(statuses[5], 429);
});

test("five reporters hide a listing; admins moderate, feature, remove and every step is audited", async () => {
  const id = (await call("/v1/marketplace/agents?q=meal")).json.data.agents[0].id;
  assert.equal((await call(`/v1/marketplace/agents/${id}/reports`, { method: "POST", value: { reason: "astrology" } })).status, 400);
  await call(`/v1/marketplace/agents/${id}/reports`, { method: "POST", value: { reason: "spam" }, ip: "10.0.0.1" });
  await call(`/v1/marketplace/agents/${id}/reports`, { method: "POST", value: { reason: "spam" }, ip: "10.0.0.1" });
  for (const ip of ["10.0.0.2", "10.0.0.3", "10.0.0.4"]) assert.equal((await call(`/v1/marketplace/agents/${id}/reports`, { method: "POST", value: { reason: "broken", details: "Did nothing." }, ip })).status, 202);
  assert.equal((await call(`/v1/marketplace/agents/${id}`)).status, 200, "four distinct reporters do not hide it");
  await call(`/v1/marketplace/agents/${id}/reports`, { method: "POST", value: { reason: "harmful" }, ip: "10.0.0.5" });
  assert.equal((await call(`/v1/marketplace/agents/${id}`)).status, 404, "the fifth hides it pending review");

  assert.equal((await call("/v1/marketplace/admin/agents")).status, 401);
  assert.equal((await call("/v1/marketplace/admin/agents", { headers: { authorization: "Bearer wrong-credential-wrong-credential-x", "x-marketplace-admin": "a@b.c" } })).status, 401);
  assert.equal((await adminCall("/v1/marketplace/admin/agents", { headers: { "x-marketplace-admin": "" } })).json.error?.code, "admin_actor_required");
  const hidden = await adminCall("/v1/marketplace/admin/agents?status=hidden");
  const row = hidden.json.data.agents.find((item: { id: string }) => item.id === id);
  assert.equal(row.openReports, 5); assert.match(row.moderationReason, /5 reports/);
  const reports = await adminCall("/v1/marketplace/admin/reports");
  assert.equal(reports.json.data.reports.filter((item: { listingId: string }) => item.listingId === id).length, 5);
  for (const item of reports.json.data.reports.filter((entry: { listingId: string }) => entry.listingId === id)) assert.equal((await adminCall(`/v1/marketplace/admin/reports/${item.id}`, { method: "PATCH", value: { status: "dismissed", note: "Works as described." } })).status, 200);
  assert.equal((await adminCall(`/v1/marketplace/admin/agents/${id}`, { method: "PATCH", value: { status: "published", featured: true } })).json.data.agent.status, "published");
  assert.equal((await call("/v1/marketplace/agents?limit=1")).json.data.agents[0].id, id, "featured sorts first");
  assert.equal((await adminCall(`/v1/marketplace/admin/agents/${id}`, { method: "PATCH", value: { status: "hidden" } })).json.error?.code, "reason_required");
  assert.equal((await adminCall(`/v1/marketplace/admin/agents/${id}`, { method: "DELETE", value: { reason: "Duplicate of another agent." } })).json.data.status, "removed");
  assert.equal((await call(`/v1/marketplace/agents/${id}/template`, { ip: "10.9.9.9" })).status, 404);
  const market = await runtime.getD1Database("MARKETPLACE", "squad-api");
  assert.equal((await market.prepare("SELECT count(*) AS n FROM listing_versions WHERE listing_id=? AND document IS NOT NULL").bind(id).first<{ n: number }>())?.n, 0, "removed content is purged");
  const events = (await adminCall(`/v1/marketplace/admin/audit?listing=${id}`)).json.data.events.map((event: { action: string; actor: string }) => event.action);
  for (const action of ["report.created", "listing.hidden", "report.dismissed", "listing.restored", "listing.featured", "listing.removed"]) assert(events.includes(action), `${action} in ${events}`);
  const audit = JSON.stringify((await adminCall("/v1/marketplace/admin/audit")).json.data);
  assert(!audit.includes("10.0.0.") && !audit.includes("example.test"), "the audit trail holds no IPs or member emails");
});
