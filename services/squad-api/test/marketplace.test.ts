// The agent marketplace (ADR-0246) in workerd with real D1: the 200 seeds,
// public browsing and caching, verified templates, publishing with
// idempotency, versions and team authority, reports, admin moderation and
// the audit trail. Only the Autohand identity provider is a fixture.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { contentHash, newAttributionId, validateAgentTemplate, validateTeamTemplate } from "../../../src/lib/marketplace.js";
import { readTeamSeeds } from "../scripts/marketplace-seed.mjs";
import { installsLabel } from "../src/marketplace.js";
import { allSeedStatements } from "../scripts/marketplace-seed.mjs";

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
  for (const name of (await readdir("marketplace-migrations")).filter(name => name.endsWith(".sql")).sort()) {
    const schema = await readFile(`marketplace-migrations/${name}`, "utf8");
    await market.batch(schema.split(";").filter(part => part.replace(/--.*$/gm, "").trim()).map(part => market.prepare(part)));
  }
  const statements = await allSeedStatements("2026-11-17T09:00:00.000Z");
  for (let index = 0; index < statements.length; index += 50) await market.batch(statements.slice(index, index + 50).map(({ sql, params }) => market.prepare(sql).bind(...params)));
  const session = async (who: string) => String((await call("/v1/auth/exchange", { method: "POST", value: { identityToken: `identity-${who}`, deviceName: who } })).json.data.token);
  alice = await session("alice"); bob = await session("bob"); carol = await session("carol");
});
after(async () => { await runtime?.dispose(); });

const additions = JSON.parse(await readFile("marketplace-seeds/additions-2026-11.json", "utf8")) as { counts: Record<string, number>; total: number };
const AGENTS = 200 + additions.total;

test("the Autohand seed agents (200 plus the 2026-11 additions) are browsable by category, creator and search, with stable pagination", async () => {
  const categories = await call("/v1/marketplace/categories");
  assert.equal(categories.json.data.total, AGENTS);
  assert.equal(categories.json.data.autohand, AGENTS);
  assert.equal(categories.json.data.teams, (await readTeamSeeds()).length);
  for (const category of categories.json.data.categories) assert.equal(category.count, 20 + additions.counts[category.id], category.id);
  const seen = new Set<string>(); let cursor = ""; let pages = 0;
  do {
    const page = await call(`/v1/marketplace/agents?limit=37${cursor ? `&cursor=${cursor}` : ""}`);
    assert.equal(page.status, 200); assert.equal(page.json.data.total, AGENTS);
    for (const agent of page.json.data.agents) { assert(!seen.has(agent.id), `duplicate ${agent.id}`); assert.equal(agent.kind, "agent"); seen.add(agent.id); }
    cursor = page.json.data.nextCursor || ""; pages += 1;
  } while (cursor && pages < 20);
  assert.equal(seen.size, AGENTS);
  const first = (await call("/v1/marketplace/agents?limit=1")).json.data.agents[0];
  assert.deepEqual(Object.keys(first.creator), ["kind", "name"]);
  assert.equal(first.creator.name, "Autohand Squad team"); assert.equal(first.createdAt, "2026-11-17T09:00:00.000Z");
  assert.equal((await call("/v1/marketplace/agents?category=finance&limit=50")).json.data.total, 20 + additions.counts.finance);
  assert.equal((await call("/v1/marketplace/agents?q=autohand%20squad%20team")).json.data.total, AGENTS);
  assert.equal((await call("/v1/marketplace/agents?q=autohand%20squad%20team&kind=all")).json.data.total, AGENTS + (await readTeamSeeds()).length);
  // Public rows carry a coarse installs label, never exact counters.
  assert.equal(first.installsLabel, ""); assert.equal(first.adds, undefined); assert.equal(first.installs, undefined);
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
  assert.equal((await call(`/v1/marketplace/agents/${id}/reports`, { method: "POST", value: { reason: "spam" }, headers: { origin: "https://evil.example" } })).status, 403);
  // The website's agent pages send reports from the visitor's own browser.
  const preflight = await call(`/v1/marketplace/agents/${id}/reports`, { method: "OPTIONS", headers: { origin: "https://autohand.ai" } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get("access-control-allow-origin"), "https://autohand.ai");
  const fromSite = await call(`/v1/marketplace/agents/${id}/reports`, { method: "POST", value: { reason: "broken", details: "From the site." }, headers: { origin: "https://autohand.ai" }, ip: "198.18.0.9" });
  assert.equal(fromSite.status, 202); assert.equal(fromSite.headers.get("access-control-allow-origin"), "https://autohand.ai");
  assert.equal((await call("/v1/marketplace/agents", { method: "POST", value: {}, headers: { origin: "https://autohand.ai" } })).status, 403, "the site origin may only report");
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
  const stats = (await adminCall(`/v1/marketplace/admin/agents?q=payroll`)).json.data.agents.find((item: { id: string }) => item.id === id).stats;
  assert.equal(stats.downloads, 2);
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
  const restored = (await adminCall(`/v1/marketplace/admin/agents/${id}`, { method: "PATCH", value: { status: "published", featured: true } })).json.data.agent;
  assert.equal(restored.status, "published");
  const featuredNow = (await call("/v1/marketplace/featured")).json.data.featured;
  assert.equal(featuredNow.at(-1).id, id, "a newly featured listing joins the end of the featured row");
  assert.equal(restored.featuredRank, featuredNow.length);
  assert((await call("/v1/marketplace/agents?limit=1")).json.data.agents[0].featured, "featured sorts first");
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

test("installs are shown publicly only as a floor from ten", () => {
  assert.deepEqual([0, 9, 10, 49, 50, 99, 100, 499, 500, 999, 1000, 4999, 5000, 80000].map(installsLabel), ["", "", "10+", "10+", "50+", "50+", "100+", "100+", "500+", "500+", "1k+", "1k+", "5k+", "5k+"]);
});

test("team templates list, preview and download as whole teams", async () => {
  const teams = await call("/v1/marketplace/agents?kind=team&limit=50");
  assert.equal(teams.json.data.total, (await readTeamSeeds()).length);
  const review = teams.json.data.agents.find((item: { name: string }) => item.name === "Code review desk");
  assert.equal(review.kind, "team"); assert.equal(review.members, 4); assert.equal(review.role, "Team of 4");
  assert.deepEqual(review.faces, ["kea", ...review.faces.slice(1)]); assert.equal(review.faces.length, 4);
  assert((await call("/v1/marketplace/agents?q=code%20review%20desk")).json.data.agents.every((item: { kind: string }) => item.kind === "agent"), "agent lists stay agents");
  assert((await call("/v1/marketplace/agents?kind=team&q=boris")).json.data.agents.some((item: { id: string }) => item.id === review.id), "a team is found by its members");
  const detail = await call(`/v1/marketplace/agents/${review.id}`);
  assert.equal(detail.json.data.preview.lead, "Alder");
  assert.deepEqual(detail.json.data.preview.members.map((member: { name: string }) => member.name), ["Alder", "Boris", "Anika", "Basil"]);
  assert.deepEqual(detail.json.data.preview.channels, [{ name: "reviews", members: 4 }]);
  assert.equal(detail.json.data.preview.instructions, undefined);
  const fetched = await call(`/v1/marketplace/agents/${review.id}/template`, { ip: "203.0.113.70" });
  const valid = validateTeamTemplate(fetched.json.data.document);
  assert(valid.ok, valid.ok ? "" : valid.error);
  assert.equal(await contentHash(valid.document), fetched.json.data.contentHash);
  assert.equal(validateAgentTemplate(fetched.json.data.document).ok, false, "an agent-only client refuses a team template");
});

test("a team template is published, refused when it carries more than people, and keeps its kind on update", async () => {
  const member = (name: string, bird = "tui") => ({ ...document(name).members[0], key: name.toLowerCase(), name, look: { avatar: `/avatars/birds/${bird}.webp`, employeeType: "" } });
  const team = (extra: Record<string, unknown> = {}) => ({ ...document("Night shift"), team: { name: "Night shift", description: "Two members who cover the evening.", lead: "Rua", exportedAt: "", app: "" },
    members: [member("Rua"), member("Tama", "kea")], channels: [{ name: "night", visibility: "public", section: "", members: ["Rua", "Tama"] }], ...extra });
  const teamListing = { ...listing, tagline: "Two members who cover the evening queue." };
  assert.equal((await call("/v1/marketplace/agents", { method: "POST", session: carol, key: "t-one", value: { owner: { kind: "user" }, creatorName: "Carol", kind: "team", listing: teamListing, document: { ...team(), members: [member("Rua")] } } })).json.error?.code, "template_invalid");
  const withRoutine = team({ routines: [{ title: "Nightly", member: "Rua", instructions: "Check.", kind: "weekdays", time: "21:00" }] });
  assert.match((await call("/v1/marketplace/agents", { method: "POST", session: carol, key: "t-routine", value: { owner: { kind: "user" }, creatorName: "Carol", kind: "team", listing: teamListing, document: withRoutine } })).json.error?.message || "", /no place for routines/);
  const leaky = team(); leaky.members[1] = { ...leaky.members[1], notes: "password: hunter2-very-secret" } as typeof leaky.members[1];
  assert.equal((await call("/v1/marketplace/agents", { method: "POST", session: carol, key: "t-leak", value: { owner: { kind: "user" }, creatorName: "Carol", kind: "team", listing: teamListing, document: leaky } })).json.error?.code, "template_secrets");
  const created = await call("/v1/marketplace/agents", { method: "POST", session: carol, key: "t-ok", value: { owner: { kind: "user" }, creatorName: "Carol", kind: "team", listing: teamListing, document: team() } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.data.agent.kind, "team"); assert.equal(created.json.data.agent.members, 2);
  assert.deepEqual(created.json.data.agent.faces, ["tui", "kea"]);
  const id = created.json.data.agent.id;
  // The kind is fixed: an update must still be a team.
  assert.equal((await call(`/v1/marketplace/agents/${id}`, { method: "PUT", session: carol, key: "t-agent", value: { baseVersion: 1, creatorName: "Carol", listing: teamListing, document: document("Solo") } })).json.error?.code, "template_invalid");
  const bigger = team(); bigger.members.push(member("Mere", "kiwi")); bigger.channels[0].members.push("Mere");
  const updated = await call(`/v1/marketplace/agents/${id}`, { method: "PUT", session: carol, key: "t-v2", value: { baseVersion: 1, creatorName: "Carol", listing: teamListing, document: bigger } });
  assert.equal(updated.status, 200, JSON.stringify(updated.json)); assert.equal(updated.json.data.agent.members, 3); assert.equal(updated.json.data.agent.kind, "team");
});

test("the home read holds the featured row in order, every category's first agents and the teams", async () => {
  const home = await call("/v1/marketplace/home?per=4");
  assert.equal(home.status, 200); assert.match(home.headers.get("cache-control") || "", /public/);
  const data = home.json.data;
  const counts = new Map((await call("/v1/marketplace/categories")).json.data.categories.map((category: { id: string; count: number }) => [category.id, category.count]));
  assert.equal(data.sections.length, 10);
  for (const section of data.sections) {
    assert.equal(section.agents.length, 4, section.id);
    assert(section.agents.every((agent: { category: string; kind: string }) => agent.category === section.id && agent.kind === "agent"));
    assert.equal(section.count, counts.get(section.id), section.id);
  }
  assert(data.teams.length >= 4 && data.teams.every((item: { kind: string }) => item.kind === "team"));
  const seeded = JSON.parse(await readFile("marketplace-seeds/featured.json", "utf8")).featured as string[];
  assert.deepEqual(data.featured.slice(0, seeded.length).map((item: { name: string }) => item.name), ["Abner", "Code review desk", "Callum", "Farah", "Hiring loop", "Noemi", "Imani", "Caleb"]);
  assert.equal((await call("/v1/marketplace/home?per=40")).status, 400);
});

test("admins reorder the featured row, and re-seeding leaves their order alone", async () => {
  const before = (await call("/v1/marketplace/featured")).json.data.featured.map((item: { id: string }) => item.id);
  const reordered = await adminCall("/v1/marketplace/admin/featured", { method: "PUT", value: { ids: [before[2], before[0]] } });
  assert.equal(reordered.status, 200, JSON.stringify(reordered.json));
  const after = (await call("/v1/marketplace/featured")).json.data.featured.map((item: { id: string }) => item.id);
  assert.deepEqual(after.slice(0, 3), [before[2], before[0], before[1]]);
  assert.equal((await adminCall("/v1/marketplace/admin/featured", { method: "PUT", value: { ids: ["zzzzzzzzzzzz"] } })).json.error?.code, "not_featured");
  assert.equal((await call("/v1/marketplace/admin/featured", { method: "PUT", value: { ids: [before[0]] } })).status, 401);
  const market = await runtime.getD1Database("MARKETPLACE", "squad-api");
  const statements = await allSeedStatements("2026-11-18T09:00:00.000Z");
  for (let index = 0; index < statements.length; index += 50) await market.batch(statements.slice(index, index + 50).map(({ sql, params }) => market.prepare(sql).bind(...params)));
  assert.deepEqual((await call("/v1/marketplace/featured")).json.data.featured.map((item: { id: string }) => item.id).slice(0, 3), after.slice(0, 3));
});

test("listing events count once per network per day, join a website click to its install, and stay anonymous", async () => {
  const id = (await call("/v1/marketplace/agents?q=sales%20call%20scorer")).json.data.agents[0].id;
  const event = (value: Record<string, unknown>, ip = "198.51.100.40", origin?: string) => call(`/v1/marketplace/agents/${id}/events`, { method: "POST", value, ip, headers: origin ? { origin } : {} });
  // The website sends views and clicks from the visitor's browser.
  const preflight = await call(`/v1/marketplace/agents/${id}/events`, { method: "OPTIONS", headers: { origin: "https://autohand.ai" } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get("access-control-allow-origin"), "https://autohand.ai");
  assert.equal((await event({ type: "view" }, "198.51.100.40", "https://evil.example")).status, 403);
  const view = await event({ type: "view" }, "198.51.100.40", "https://autohand.ai");
  assert.equal(view.status, 202); assert.equal(view.json.data.counted, true);
  assert.equal((await event({ type: "view" }, "198.51.100.40", "https://autohand.ai")).json.data.counted, false, "a reload is not a second view");
  await event({ type: "view" }, "198.51.100.41", "https://autohand.ai");
  const attribution = newAttributionId();
  assert.match(attribution, /^[a-z0-9]{20}$/);
  assert.equal((await event({ type: "add_click", source: "website", attribution }, "198.51.100.40", "https://autohand.ai")).status, 202);
  // Squad reports the install after the import succeeded, with the id the link carried.
  assert.equal((await event({ type: "install", source: "website-link", attribution, version: 1 }, "198.51.100.200")).status, 202);
  assert.equal((await event({ type: "install", source: "in-app" }, "198.51.100.201")).status, 202);
  assert.equal((await event({ type: "install", source: "in-app", attribution: newAttributionId() }, "198.51.100.202")).status, 202, "an unknown attribution counts the install, joins nothing");
  assert.equal((await event({ type: "download" })).status, 400);
  assert.equal((await event({ type: "view", email: "a@b.c" })).status, 400, "nothing but the event fields");
  assert.equal((await event({ type: "view", attribution: "short" })).status, 400);
  assert.equal((await call("/v1/marketplace/agents/zzzzzzzzzzzz/events", { method: "POST", value: { type: "view" } })).status, 404);
  const row = (await adminCall("/v1/marketplace/admin/agents?q=sales%20call%20scorer")).json.data.agents.find((item: { id: string }) => item.id === id);
  assert.deepEqual(row.stats, { views: 2, addClicks: 1, downloads: 0, installs: 3, attributedInstalls: 1 });
  const stats = (await adminCall(`/v1/marketplace/admin/stats?days=7&listing=${id}`)).json.data;
  assert.deepEqual(stats.totals, { views: 2, addClicks: 1, downloads: 0, installs: 3 });
  assert.deepEqual(stats.attribution, { clicks: 1, installs: 1 });
  assert.equal(stats.daily.length, 1);
  assert.equal((await adminCall("/v1/marketplace/admin/stats?days=7")).json.data.top[0].id, id);
  const market = await runtime.getD1Database("MARKETPLACE", "squad-api");
  const stored = JSON.stringify((await market.prepare("SELECT * FROM listing_event_seen").all()).results) + JSON.stringify((await market.prepare("SELECT * FROM attributions").all()).results);
  assert(!stored.includes("198.51.100"), "no address is stored");
  const burst = [];
  for (let index = 0; index < 121; index += 1) burst.push((await event({ type: "view" }, "198.51.100.99")).status);
  assert.equal(burst.at(-1), 429);
});

// ADR-0285: admins add and edit Autohand's own listings, choose their
// connectors, publish and unpublish them, and read search demand.
const fields = (name = "Wren") => ({ name, role: "Release notes writer", bird: "tui", instructions: "Act as a release notes writer. Read merged changes and write notes for users.",
  brainCard: { purpose: "Write release notes people read." }, skills: [skill], notes: "" });
const adminListingInput = { tagline: "Turns a week of merged changes into release notes.", description: "Groups changes by who they affect.", category: "engineering", tags: ["release"] };

test("admins draft an Autohand agent unpublished, publish it, edit it into a new version and unpublish it", async () => {
  const created = await adminCall("/v1/marketplace/admin/agents", { method: "POST", value: { fields: fields(), listing: adminListingInput, connectors: ["github", "slack"] } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json.data.agent.id;
  assert.equal(created.json.data.agent.status, "unpublished", "a new agent is a draft until published");
  assert.equal(created.json.data.agent.creator.kind, "autohand");
  assert.equal(created.json.data.editable, true);
  assert.equal(created.json.data.fields.name, "Wren"); assert.equal(created.json.data.fields.skills[0].name, "release-checklist");
  assert.deepEqual(created.json.data.connectors, ["github", "slack"]);
  assert.equal((await call(`/v1/marketplace/agents/${id}`)).status, 404, "a draft is not public");
  const published = await adminCall(`/v1/marketplace/admin/agents/${id}`, { method: "PATCH", value: { status: "published" } });
  assert.equal(published.json.data.agent.status, "published");
  const page = (await call(`/v1/marketplace/agents/${id}`)).json.data.agent;
  assert.deepEqual(page.connectors, ["github", "slack"], "the public listing carries the chosen connectors");
  const template = (await call(`/v1/marketplace/agents/${id}/template`, { ip: "198.51.100.150" })).json.data;
  assert(validateAgentTemplate(template.document).ok, "an admin-built agent is an ordinary template");
  assert.equal(template.contentHash, await contentHash(template.document));

  const edited = await adminCall(`/v1/marketplace/admin/agents/${id}`, { method: "PUT", value: { baseVersion: 1, fields: { ...created.json.data.fields, name: "Wren Ruru", bird: "ruru" }, listing: { ...adminListingInput, tagline: "Release notes from merged changes, grouped by audience." }, connectors: [], note: "Clearer tagline." } });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  assert.equal(edited.json.data.agent.version, 2); assert.equal(edited.json.data.agent.name, "Wren Ruru"); assert.equal(edited.json.data.agent.bird, "ruru");
  assert.equal((await call(`/v1/marketplace/agents/${id}`)).json.data.agent.connectors, undefined, "no connectors chosen: the website infers them");
  assert.equal((await adminCall(`/v1/marketplace/admin/agents/${id}`, { method: "PUT", value: { baseVersion: 1, fields: created.json.data.fields, listing: adminListingInput } })).json.error?.code, "version_conflict");
  assert.equal((await adminCall(`/v1/marketplace/admin/agents/${id}`, { method: "PUT", value: { baseVersion: 2, fields: { ...created.json.data.fields, instructions: "Use key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnop to post." }, listing: adminListingInput } })).json.error?.code, "template_secrets");
  assert.equal((await adminCall(`/v1/marketplace/admin/agents/${id}`, { method: "PUT", value: { baseVersion: 2, fields: created.json.data.fields, listing: adminListingInput, connectors: ["notion"] } })).status, 400, "only connectors the website can draw");
  const versions = (await call(`/v1/marketplace/agents/${id}`)).json.data.versions.map((item: { version: number }) => item.version);
  assert.deepEqual(versions, [2, 1]);

  assert.equal((await adminCall(`/v1/marketplace/admin/agents/${id}`, { method: "PATCH", value: { status: "unpublished" } })).json.data.agent.status, "unpublished");
  assert.equal((await call(`/v1/marketplace/agents/${id}`)).status, 404);
  assert.equal((await adminCall(`/v1/marketplace/admin/agents/${id}`, { method: "PATCH", value: { status: "published" } })).json.data.agent.status, "published", "admins republish Autohand's own agents");
  const actions = (await adminCall(`/v1/marketplace/admin/audit?listing=${id}`)).json.data.events.map((event: { action: string }) => event.action);
  assert.deepEqual(actions, ["listing.published", "listing.unpublished", "listing.updated", "listing.published", "listing.drafted"]);
  assert.equal((await call("/v1/marketplace/admin/agents", { method: "POST", value: { fields: fields(), listing: adminListingInput } })).status, 401);
});

test("admins edit a seed team's listing but not its members, and never someone else's listing", async () => {
  const team = (await call("/v1/marketplace/agents?kind=team&limit=1")).json.data.agents[0];
  const read = (await adminCall(`/v1/marketplace/admin/agents/${team.id}`)).json.data;
  assert.equal(read.editable, true); assert(read.team.members.length >= 2); assert.equal(read.fields, undefined);
  const saved = await adminCall(`/v1/marketplace/admin/agents/${team.id}`, { method: "PUT", value: { baseVersion: read.agent.version, listing: { ...read.listing, tagline: "A whole team, reworded by an admin." }, connectors: ["linear"] } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.data.agent.tagline, "A whole team, reworded by an admin."); assert.equal(saved.json.data.team.members.length, read.team.members.length);
  assert.equal((await adminCall(`/v1/marketplace/admin/agents/${team.id}`, { method: "PUT", value: { baseVersion: saved.json.data.agent.version, fields: fields(), listing: read.listing } })).json.error?.code, "team_fields");
  const theirs = (await call("/v1/marketplace/agents", { method: "POST", session: alice, key: "admin-edit-theirs", value: { owner: { kind: "user" }, document: document("Moana"), listing } })).json.data.agent;
  const refused = await adminCall(`/v1/marketplace/admin/agents/${theirs.id}`, { method: "PUT", value: { baseVersion: 1, fields: fields("Moana"), listing } });
  assert.equal(refused.json.error?.code, "listing_not_autohand");
  assert.equal((await adminCall(`/v1/marketplace/admin/agents/${theirs.id}`)).json.data.editable, false);
  assert.equal((await adminCall(`/v1/marketplace/admin/agents/${theirs.id}`, { method: "PATCH", value: { status: "unpublished" } })).json.error?.code, "listing_not_autohand", "a publisher's agent is hidden, not unpublished, by admins");
});

test("first-page searches are counted by their words per day, with the ones that found nothing", async () => {
  await call("/v1/marketplace/agents?q=Payroll%20%20Reconciliation&kind=all");
  await call("/v1/marketplace/agents?q=payroll%20reconciliation");
  await call("/v1/marketplace/agents?q=zebra%20wrangler");
  await call("/v1/marketplace/agents?q=x");
  const first = (await call("/v1/marketplace/agents?q=engineering&limit=1")).json.data;
  await call(`/v1/marketplace/agents?q=engineering&limit=1&cursor=${first.nextCursor}`);
  const searches = (await adminCall("/v1/marketplace/admin/searches?days=7")).json.data;
  const term = (name: string) => searches.top.find((item: { term: string }) => item.term === name);
  assert.equal(term("payroll reconciliation").searches, 2);
  assert.equal(term("engineering").searches, 1, "a next page is not another search");
  assert.equal(term("x"), undefined, "one letter is not recorded");
  assert.deepEqual(searches.empty.find((item: { term: string }) => item.term === "zebra wrangler"), { term: "zebra wrangler", searches: 1, empty: 1 });
  const market = await runtime.getD1Database("MARKETPLACE", "squad-api");
  assert.deepEqual(Object.keys((await market.prepare("SELECT * FROM search_queries LIMIT 1").first()) || {}).sort(), ["day", "empty", "searches", "term"], "only the words, the day and the counts");
  const stats = (await adminCall("/v1/marketplace/admin/stats?days=7")).json.data;
  const engineering = stats.categories.find((item: { category: string }) => item.category === "engineering");
  assert(engineering.listings > 0 && engineering.label === "Engineering");
});
