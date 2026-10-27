import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createTeamStore } from "../../../server/team/store.mjs";
import { createSquadCloud } from "../../../server/squad-cloud/service.mjs";
import { buildSquadRelease } from "../../../scripts/publish-squad-api-release.mjs";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

let runtime: Miniflare;
let alice: string; let bob: string; let tenant: string; let space: string; let otherTenant: string; let otherSpace: string;
const publisher = "fixture-publisher-credential-32-characters";
async function call(path: string, method = "GET", value?: unknown, session?: string, key?: string) {
  const response = await runtime.dispatchFetch(`https://squad.example.test${path}`, { method,
    headers: { ...(session ? { authorization: `Bearer ${session}` } : {}), ...(value === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const json = await response.json<{ success: boolean; data: Record<string, unknown>; error?: { code: string } }>();
  return { status: response.status, json, headers: response.headers };
}
const prefix = () => `/v1/tenants/${tenant}/workspaces/${space}`;
const content = (text: string) => ({ text, scope: "team", memberId: null, projectId: null });
const write = (id: string, baseRevision: number, text: string | null, session = alice, key = crypto.randomUUID()) => call(`${prefix()}/memory/${id}`, "PUT", { baseRevision, content: text === null ? null : content(text) }, session, key);

before(async () => {
  const bundle = await build({ entryPoints: ["src/index.ts"], bundle: true, write: false, format: "esm", platform: "browser", target: "es2024" });
  runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "squad-api", modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-10-27",
    d1Databases: ["DB"], r2Buckets: ["MEMORY", "RELEASES"],
    bindings: { IDENTITY_ORIGIN: "https://api.autohand.ai", WEB_ORIGIN: "https://squad.example.test", RELEASE_PUBLISHER_TOKEN: publisher },
    // Only the external identity provider is a fixture. Router, authentication,
    // D1 transactions, R2 objects and HTTP responses execute in workerd.
    outboundService: "identity-fixture",
  }, { name: "identity-fixture", modules: true, compatibilityDate: "2026-10-27", script: `export default {fetch(request) {
    const identity = request.headers.get("authorization")?.replace("Bearer identity-", "");
    if (!["alice", "bob"].includes(identity || "")) return new Response("{}", {status:401});
    return Response.json({success:true,profile:{id:"identity_"+identity,email:identity+"@example.test",name:identity,status:"active"}});
  }}` }] }));
  const db = await runtime.getD1Database("DB", "squad-api");
  const migration = await readFile("migrations/0001_control_plane.sql", "utf8");
  await db.batch(migration.split(";").filter(sql => sql.trim()).map(sql => db.prepare(sql)));
  const signedIn = await call("/v1/auth/exchange", "POST", { identityToken: "identity-alice", deviceName: "Alice's Mac" });
  assert.equal(signedIn.status, 201, JSON.stringify(signedIn.json));
  alice = String(signedIn.json.data.token);
  bob = String((await call("/v1/auth/exchange", "POST", { identityToken: "identity-bob", deviceName: "Bob's Mac" })).json.data.token);
  assert.match(alice, /^ss_[a-f0-9]{64}$/);
  tenant = String((await call("/v1/tenants", "POST", { name: "Alice team" }, alice)).json.data.id);
  space = String((await call(`/v1/tenants/${tenant}/workspaces`, "POST", { name: "Product" }, alice)).json.data.id);
  otherTenant = String((await call("/v1/tenants", "POST", { name: "Bob team" }, bob)).json.data.id);
  otherSpace = String((await call(`/v1/tenants/${otherTenant}/workspaces`, "POST", { name: "Private" }, bob)).json.data.id);
});
after(async () => { await runtime?.dispose(); });

test("identity exchange creates revocable Squad sessions and never stores identity credentials", async () => {
  assert.equal((await call("/v1/auth/exchange", "POST", { identityToken: "bad", deviceName: "Bad" })).status, 401);
  assert.equal((await call("/v1/me", "GET", undefined, "identity-alice")).status, 401);
  const db = await runtime.getD1Database("DB");
  const sessions = await db.prepare("SELECT token_hash FROM sessions").all();
  assert(!JSON.stringify(sessions).includes(alice)); assert(!JSON.stringify(sessions).includes("identity-alice"));
  assert.equal((await call("/v1/me", "GET", undefined, alice)).headers.get("cache-control"), "no-store");
});
test("tenant and workspace IDs cannot cross membership boundaries", async () => {
  assert.equal((await call(`/v1/tenants/${tenant}/members`, "GET", undefined, bob)).status, 404);
  assert.equal((await call(`/v1/tenants/${tenant}/workspaces/${otherSpace}/memory`, "GET", undefined, alice)).status, 404);
  assert.equal((await call(`${prefix()}/memory`, "GET", undefined, bob)).status, 404);
  assert.equal((await call(`${prefix()}/memory/x`, "PUT", { baseRevision: 0, content: content("private") }, bob, "bad-tenant")).status, 404);
});
test("R2 JSON round trips; retries replay the original revision; tombstones reject stale resurrection", async () => {
  const created = await write("fact", 0, "Use separate tenant namespaces", alice, "create-fact");
  assert.equal(created.status, 201); assert.equal(created.json.data.revision, 1);
  assert.equal((await write("fact", 0, "Use separate tenant namespaces", alice, "create-fact")).json.data.revision, 1);
  assert.equal((await write("other", 0, "different", alice, "create-fact")).json.error?.code, "idempotency_conflict");
  assert.equal((await write("fact", 0, "stale write")).status, 409);
  assert.equal((await write("fact", 1, null)).json.data.revision, 2);
  assert.equal((await write("fact", 0, "resurrected")).status, 409);
  const deleted = await call(`${prefix()}/memory/fact`, "GET", undefined, alice);
  assert.equal(deleted.json.data.deleted, true); assert.equal(deleted.json.data.content, null);
  const bucket = await runtime.getR2Bucket("MEMORY"); const objects = await bucket.list();
  assert(objects.objects.every(object => object.key.startsWith(`tenants/${tenant}/workspaces/${space}/`)));
});
test("competing devices produce one accepted revision, and concurrent duplicate mutations replay", async () => {
  const outcomes = await Promise.all(Array.from({ length: 12 }, (_, i) => write("race", 0, `device ${i}`)));
  assert.equal(outcomes.filter(result => result.status === 201).length, 1);
  assert(outcomes.filter(result => result.status !== 201).every(result => result.status === 409));
  const duplicates = await Promise.all(Array.from({ length: 8 }, () => write("retry", 0, "one logical mutation", alice, "retry-key")));
  assert(duplicates.every(result => [200, 201].includes(result.status) && result.json.data.revision === 1));
  const db = await runtime.getD1Database("DB");
  assert.equal((await db.prepare("SELECT count(*) AS n FROM memory_changes WHERE entry_id='retry'").first<{ n: number }>())?.n, 1);
});
test("change pagination is scoped, ordered and includes deletions", async () => {
  let cursor = 0; const ids: unknown[] = []; const sequences: number[] = []; let more = true;
  while (more) {
    const result = await call(`${prefix()}/memory/changes?cursor=${cursor}&limit=2`, "GET", undefined, alice);
    const entries = result.json.data.entries as { sequence: number; id: string; deleted: boolean }[];
    ids.push(...entries.map(entry => entry.id)); sequences.push(...entries.map(entry => entry.sequence));
    cursor = Number(result.json.data.cursor); more = Boolean(result.json.data.hasMore);
  }
  assert.equal(ids.filter(id => id === "fact").length, 2);
  assert(sequences.every((sequence, index) => index === 0 || sequence > sequences[index - 1]));
  assert.equal((await call(`${prefix()}/memory/changes?cursor=-1`, "GET", undefined, alice)).status, 400);
});
test("viewer access, invite ownership, role changes and revocation apply on the next request", async () => {
  const invitation = await call(`/v1/tenants/${tenant}/invitations`, "POST", { email: "bob@example.test", role: "viewer" }, alice);
  assert.equal((await call("/v1/invitations/accept", "POST", { token: invitation.json.data.token }, alice)).status, 404);
  assert.equal((await call("/v1/invitations/accept", "POST", { token: invitation.json.data.token }, bob)).status, 200);
  assert.equal((await call(`${prefix()}/memory/fact`, "GET", undefined, bob)).status, 200);
  assert.equal((await write("viewer-write", 0, "not permitted", bob)).status, 403);
  const me = await call("/v1/me", "GET", undefined, bob); const bobId = me.json.data.id;
  await call(`/v1/tenants/${tenant}/members/${bobId}`, "PATCH", { role: "editor" }, alice);
  assert.equal((await write("editor-write", 0, "permitted", bob)).status, 201);
  await call(`/v1/tenants/${tenant}/members/${bobId}`, "DELETE", undefined, alice);
  assert.equal((await call(`${prefix()}/memory/fact`, "GET", undefined, bob)).status, 404);
  const owner = await call("/v1/me", "GET", undefined, alice);
  assert.equal((await call(`/v1/tenants/${tenant}/members/${owner.json.data.id}`, "DELETE", undefined, alice)).status, 403);
});
test("only the release publisher can publish; public metadata has ETags and verified installer URLs", async () => {
  const manifest = { schemaVersion: 1, channel: "stable", version: "0.1.11", releasedAt: new Date().toISOString(), notes: "Fixture only", releaseUrl: "https://github.com/autohandai/squad/releases/tag/v0.1.11", assets: [{ os: "macos", arch: "arm64", name: "autohand-squad-0.1.11-macos-arm64.dmg", url: "https://github.com/autohandai/squad/releases/download/v0.1.11/autohand-squad-0.1.11-macos-arm64.dmg", sha256: "a".repeat(64), bytes: 100 }] };
  const path = "/v1/releases/stable/manifest";
  assert.equal((await call(path, "PUT", manifest, alice)).status, 401);
  assert.equal((await call(path, "PUT", manifest, publisher)).status, 201);
  const response = await runtime.dispatchFetch(`https://squad.example.test${path}`); assert.equal(response.status, 200);
  assert.equal((await response.json<{ version: string }>()).version, "0.1.11");
  const cached = await runtime.dispatchFetch(`https://squad.example.test${path}`, { headers: { "if-none-match": response.headers.get("etag") || "" } });
  assert.equal(cached.status, 304); assert.match(response.headers.get("cache-control") || "", /^public/);
  manifest.assets[0].url = "https://attacker.example/installer.dmg";
  assert.equal((await call(path, "PUT", manifest, publisher)).status, 400);
});
test("two isolated desktops opt in, sync R2 memories, resolve conflicts, and propagate only explicit deletes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "squad-cloud-contract-"));
  const syncSpace = String((await call(`/v1/tenants/${tenant}/workspaces`, "POST", { name: "Sync contract" }, alice)).json.data.id);
  const first = createTeamStore({ stateDir: join(directory, "first") }); const second = createTeamStore({ stateDir: join(directory, "second") });
  let calls = 0; let identity = "identity-alice";
  const fetchImpl = (url: string, options: RequestInit) => { calls++; return runtime.dispatchFetch(url, options); };
  const one = createSquadCloud({ stateDir: join(directory, "first"), store: first, readIdentityToken: () => "identity-alice", baseUrl: "https://squad.example.test", fetchImpl });
  const two = createSquadCloud({ stateDir: join(directory, "second"), store: second, readIdentityToken: () => identity, baseUrl: "https://squad.example.test", fetchImpl });
  try {
    const fact = await first.remember({ text: "Keep provider proof separate from local checks", scope: "team" });
    await one.sync(); assert.equal(calls, 0, "disabled sync never contacts the cloud");
    await one.discover();
    const db = await runtime.getD1Database("DB", "squad-api");
    assert.equal((await db.prepare("SELECT count(*) AS n FROM memory_entries WHERE workspace_id=?").bind(syncSpace).first<{ n: number }>())?.n, 0, "choosing a workspace does not upload memories");
    const selection = { tenantId: tenant, workspaceId: syncSpace };
    assert.equal((await one.connect(selection)).error, "");
    assert.equal((await two.connect(selection)).error, "");
    assert.equal((await second.read()).memory.find(entry => entry.id === fact.id)?.text, fact.text);
    await first.updateMemory(fact.id, "First computer edit", { person: true });
    await second.updateMemory(fact.id, "Second computer edit", { person: true });
    await one.sync();
    const conflict = await two.sync(); assert.equal(conflict.conflicts.length, 1);
    assert.equal((await second.read()).memory[0].text, "Second computer edit", "conflict preserves the local edit");
    assert.equal((await two.resolve(fact.id, "remote")).conflicts.length, 0);
    assert.equal((await second.read()).memory[0].text, "First computer edit");
    await first.forget(fact.id, { person: true }); await one.sync(); await two.sync();
    assert(!(await second.read()).memory.some(entry => entry.id === fact.id), "explicit deletion propagates");
    const retained = await first.remember({ text: "An empty local file is not a delete instruction", scope: "team" });
    await one.sync(); await two.sync();
    await second.mutate(state => { state.memory = []; }); await two.sync();
    const remote = await call(`/v1/tenants/${tenant}/workspaces/${syncSpace}/memory/${retained.id}`, "GET", undefined, alice);
    assert.equal(remote.json.data.deleted, false, "retention or absence cannot delete a cloud entry");
    identity = "";
    assert.match((await two.sync()).error, /Sign in/);
    identity = "identity-bob";
    assert.match((await two.sync()).error, /another account/);
    assert.equal((await stat(join(directory, "first", "cloud-sync.json"))).mode & 0o777, 0o600);
    await one.disconnect(); assert.equal((await one.status()).enabled, false);
  } finally { one.close(); two.close(); await rm(directory, { recursive: true, force: true }); }
});
test("published installer metadata covers each desktop target and retries identically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "squad-feed-contract-"));
  try {
    const names = ["macos-arm64.dmg", "macos-x64.dmg", "windows-x64-setup.exe", "linux-x64.deb"].map(target => `autohand-squad-0.1.12-${target}`);
    const checksums = [];
    for (const name of names) { const bytes = Buffer.from(`fixture-${name}`); await writeFile(join(directory, name), bytes); checksums.push(`${createHash("sha256").update(bytes).digest("hex")}  ${name}`); }
    await writeFile(join(directory, "checksums.txt"), `${checksums.join("\n")}\n`);
    const input = { directory, version: "0.1.12", notes: "Verified fixture release", releasedAt: "2026-10-27T00:00:00Z" };
    const manifest = await buildSquadRelease(input);
    assert.deepEqual(await buildSquadRelease(input), manifest);
    assert.equal(manifest.assets.length, 4);
    assert.equal((await call("/v1/releases/stable/manifest", "PUT", manifest, publisher)).status, 201);
    assert.equal((await call("/v1/releases/stable/manifest", "PUT", manifest, publisher)).status, 200);
    await writeFile(join(directory, names[0]), "corrupt");
    await assert.rejects(buildSquadRelease(input), /checksum/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("session revocation and disallowed browser origins fail closed", async () => {
  const blocked = await runtime.dispatchFetch("https://squad.example.test/v1/me", { headers: { origin: "https://untrusted.example", authorization: `Bearer ${alice}` } });
  assert.equal(blocked.status, 403); assert.equal(blocked.headers.get("access-control-allow-origin"), null);
  await call("/v1/auth/session", "DELETE", undefined, bob);
  assert.equal((await call("/v1/me", "GET", undefined, bob)).status, 401);
});
