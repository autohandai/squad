// Member profiles in the owner's Autohand account (ADR-0280): the Worker's
// revisioned store in workerd, and two desktop computers syncing through it.
// Only the identity provider is a fixture; each "computer" is the real
// createProfileCloud with an in-memory member list and a revision-checked save.
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile, readdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createProfileCloud } from "../../../server/squad-cloud/profiles.mjs";

let runtime: Miniflare, alice = "";
const origin = "https://profiles.example.test";
async function call<T = Record<string, unknown>>(path: string, method = "GET", value?: unknown, session = alice, identity?: string, key?: string) {
  const response = await runtime.dispatchFetch(`${origin}${path}`, { method,
    headers: { ...(session ? { authorization: `Bearer ${session}` } : {}), ...(identity ? { "x-autohand-identity": identity } : {}), ...(value === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  return { status: response.status, json: await response.json<{ success: boolean; data: T; error?: { code: string } }>() };
}
const profile = (name: string, extra: Record<string, unknown> = {}) => ({ name, role: "QA", description: "Checks releases", instructions: "Read the evidence first.", personality: "Calm", skills: [], avatar: "kea", voice: "", ...extra });

before(async () => {
  const bundle = await build({ entryPoints: ["src/index.ts"], bundle: true, write: false, format: "esm", platform: "browser", target: "es2024", external: ["cloudflare:workers"] });
  runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "squad-profiles", modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-10-27",
    d1Databases: ["DB"], r2Buckets: ["MEMORY", "RELEASES"],
    bindings: { IDENTITY_ORIGIN: "https://api.autohand.ai", WEB_ORIGIN: origin, RELEASE_PUBLISHER_TOKEN: "unused" },
    outboundService: "profiles-identity",
  }, { name: "profiles-identity", modules: true, compatibilityDate: "2026-10-27", script: `export default { async fetch(request) {
    const url = new URL(request.url), who = request.headers.get('authorization')?.replace('Bearer identity-', '');
    if (!['alice','bob'].includes(who)) return Response.json({success:false}, {status:401});
    if (url.pathname === '/v1/profile') return Response.json({success:true,profile:{id:'identity_'+who,email:who+'@example.test',name:who,status:'active'}});
    if (url.pathname === '/v1/accounts') return Response.json({success:true,accounts:[{account:{id:'team-shared',name:'Shared',type:'team',accessMode:'full',status:'active'},role:who==='alice'?'owner':'contributor',permissions:who==='alice'?['resources:operate']:[]}]});
    return Response.json({success:false},{status:404});
  }};` }] }));
  const db = await runtime.getD1Database("DB", "squad-profiles");
  for (const name of (await readdir("migrations")).filter(name => name.endsWith(".sql")).sort()) {
    const migration = await readFile(`migrations/${name}`, "utf8");
    await db.batch(migration.split(";").filter(sql => sql.replace(/--.*$/gm, "").trim()).map(sql => db.prepare(sql)));
  }
  alice = String((await call("/v1/auth/exchange", "POST", { identityToken: "identity-alice", deviceName: "Alice" }, "")).json.data.token);
});
after(async () => { await runtime?.dispose(); });

test("the Worker keeps one revisioned profile per member and owner", async () => {
  const bob = String((await call("/v1/auth/exchange", "POST", { identityToken: "identity-bob", deviceName: "Bob" }, "")).json.data.token);
  assert.equal((await call("/v1/users/me/profiles", "GET", undefined, "")).status, 401);
  assert.equal((await call("/v1/users/me/profiles/eva", "PUT", { baseRevision: 0, content: profile("Eva") })).json.error?.code, "idempotency_required");
  const created = await call("/v1/users/me/profiles/eva", "PUT", { baseRevision: 0, content: profile("Eva") }, alice, undefined, "create-eva");
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal((await call("/v1/users/me/profiles/eva", "PUT", { baseRevision: 0, content: profile("Eva") }, alice, undefined, "create-eva")).status, 200, "a repeated request replays");
  assert.equal((await call("/v1/users/me/profiles/eva", "PUT", { baseRevision: 0, content: profile("Eve") }, alice, undefined, "again")).json.error?.code, "revision_conflict");
  assert.equal((await call("/v1/users/me/profiles/eva", "PUT", { baseRevision: 1, content: { ...profile("Eva"), workspace: "/Users/alice" } }, alice, undefined, "paths")).status, 400, "paths are not part of a profile");
  assert.equal((await call("/v1/users/me/profiles/eva", "PUT", { baseRevision: 1, content: profile("Eva", { avatar: "https://x.test/a.png" }) }, alice, undefined, "photo")).status, 400, "only a cast bird id");
  assert.equal((await call("/v1/users/me/profiles/eva", "GET", undefined, bob)).status, 404, "another account cannot read it");
  assert.equal((await call<{ profiles: unknown[] }>("/v1/users/me/profiles", "GET", undefined, bob)).json.data.profiles.length, 0);
  assert.equal((await call("/v1/teams/team-shared/profiles", "GET")).json.error?.code, "identity_required");
  assert.equal((await call("/v1/teams/team-shared/profiles/eva", "PUT", { baseRevision: 0, content: profile("Eva") }, bob, "identity-bob", "bob-team")).status, 403, "a team member without operate rights cannot write");
  assert.equal((await call("/v1/teams/team-shared/profiles/eva", "PUT", { baseRevision: 0, content: profile("Team Eva") }, alice, "identity-alice", "alice-team")).status, 201);
  assert.equal((await call<{ content: { name: string } }>("/v1/teams/team-shared/profiles/eva", "GET", undefined, bob, "identity-bob")).json.data.content.name, "Team Eva");
  assert.equal((await call<{ content: { name: string } }>("/v1/users/me/profiles/eva")).json.data.content.name, "Eva", "the personal and team namespaces are separate");
});

type Member = { id: string; revision: number; profile: Record<string, unknown> };
function computer(directory: string, name: string, owner = { kind: "user" as const, id: "identity_alice", issuer: "https://api.autohand.ai", actorId: "identity_alice" }) {
  const list: Member[] = [];
  let identity = "identity-alice", calls = 0, signedOwner: typeof owner | null = owner, created = 0;
  const fetchImpl = (url: string, options: RequestInit) => { calls++; return runtime.dispatchFetch(url, options); };
  const cloud = createProfileCloud({ stateDir: join(directory, name), baseUrl: origin, fetchImpl: fetchImpl as typeof fetch, interval: 3_600_000,
    readIdentityToken: () => identity, readOwner: () => signedOwner,
    members: async () => structuredClone(list),
    apply: async (id: string, changes: Record<string, unknown>, expectedRevision: number) => {
      const member = list.find(item => item.id === id); if (!member) throw Error("Member not found.");
      if (member.revision !== expectedRevision) throw Object.assign(Error("Member profile changed."), { status: 409 });
      if (Array.isArray(changes.skills) && changes.skills.includes("missing-skill")) throw Error("That skill is not installed here.");
      Object.assign(member.profile, changes); member.revision++;
    },
    create: async (_cloudId: string, value: Record<string, unknown>) => { const id = `member-${name}-${++created}`; list.push({ id, revision: 1, profile: { ...value } }); return id; },
  });
  return { cloud, list, edit(id: string, changes: Record<string, unknown>) { const member = list.find(item => item.id === id)!; Object.assign(member.profile, changes); member.revision++; },
    get calls() { return calls; }, set identity(value: string) { identity = value; }, set owner(value: typeof owner | null) { signedOwner = value; } };
}

test("two computers keep the same member through the account, merge fields and ask about clashes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "squad-profile-cloud-"));
  const one = computer(directory, "one"), two = computer(directory, "two");
  try {
    // Signed out: off, and nothing is sent.
    one.owner = null;
    assert.equal((await one.cloud.sync()).available, false); assert.equal(one.calls, 0, "no owner, no traffic");
    one.owner = { kind: "user", id: "identity_alice", issuer: "https://api.autohand.ai", actorId: "identity_alice" };
    // Turned off by the person: nothing is sent either.
    assert.equal((await one.cloud.setEnabled(false)).enabled, false);
    one.list.push({ id: "member-iris", revision: 3, profile: profile("Iris", { avatar: "kea", voice: "Ava" }) });
    await one.cloud.sync(); assert.equal(one.calls, 0, "disabled sync never contacts the account");
    // A personal Squad is on by default once signed in.
    assert.equal((await one.cloud.setEnabled(true)).enabled, true);
    assert.equal((await call<{ content: { name: string; voice: string } }>("/v1/users/me/profiles/member-iris")).json.data.content.voice, "Ava", "pushed");
    assert.equal((await stat(join(directory, "one", "profile-cloud.json"))).mode & 0o777, 0o600);

    // The second computer has no Iris: it is listed and can be added.
    const listed = await two.cloud.sync();
    const ids = (state: { cloudOnly: { id: string }[] }) => state.cloudOnly.map(entry => entry.id).filter(id => id.startsWith("member-"));
    assert.deepEqual(ids(listed), ["member-iris"]);
    const added = await two.cloud.add("member-iris");
    assert.deepEqual(ids(added), []);
    const copy = two.list[0]; assert.equal(copy.profile.name, "Iris"); assert.equal(copy.profile.avatar, "kea");

    // Different fields on each side merge.
    one.edit("member-iris", { role: "Release QA" });
    two.edit(copy.id, { instructions: "Check the changelog too." });
    await one.cloud.sync(); await two.cloud.sync(); await one.cloud.sync();
    for (const member of [one.list[0], two.list[0]]) {
      assert.equal(member.profile.role, "Release QA"); assert.equal(member.profile.instructions, "Check the changelog too.");
    }

    // The same field on both sides: each computer keeps its own and asks.
    one.edit("member-iris", { description: "One's words" });
    two.edit(copy.id, { description: "Two's words" });
    await one.cloud.sync();
    const clash = await two.cloud.sync();
    assert.equal(clash.conflicts.length, 1); assert.deepEqual(clash.conflicts[0].fields.map((field: { field: string }) => field.field), ["description"]);
    assert.equal(two.list[0].profile.description, "Two's words", "this computer's value is kept until the person chooses");
    assert.equal((await two.cloud.resolve("member-iris", "cloud")).conflicts.length, 0);
    assert.equal(two.list[0].profile.description, "One's words");

    // ...and the other choice sends this computer's value to the account.
    one.edit("member-iris", { personality: "Wry" });
    two.edit(copy.id, { personality: "Gentle" });
    await one.cloud.sync(); assert.equal((await two.cloud.sync()).conflicts.length, 1);
    assert.equal((await two.cloud.resolve("member-iris", "local")).conflicts.length, 0);
    await one.cloud.sync();
    assert.equal(one.list[0].profile.personality, "Gentle");

    // A skill the other computer lacks is reported, not forced, not undone.
    one.edit("member-iris", { skills: ["missing-skill"] });
    await one.cloud.sync();
    const note = await two.cloud.sync();
    assert.match(note.notes[0].message, /skills could not be used here/);
    assert.deepEqual(two.list[0].profile.skills, []);
    assert.deepEqual((await call<{ content: { skills: string[] } }>("/v1/users/me/profiles/member-iris")).json.data.content.skills, ["missing-skill"], "the account keeps the other computer's choice");
    // ...and later changes still arrive; the missing skill is not pushed back as a removal.
    one.edit("member-iris", { role: "QA lead" });
    await one.cloud.sync(); await two.cloud.sync();
    assert.equal(two.list[0].profile.role, "QA lead");
    two.edit(copy.id, { voice: "Kai" }); await two.cloud.sync();
    const kept = (await call<{ content: { skills: string[]; voice: string } }>("/v1/users/me/profiles/member-iris")).json.data.content;
    assert.deepEqual(kept.skills, ["missing-skill"]); assert.equal(kept.voice, "Kai");

    // Removing a member here leaves it in the account, listed for adding back.
    one.list.splice(0, 1);
    assert.deepEqual(ids(await one.cloud.sync()), ["member-iris"]);
    assert.equal((await call<{ deleted: boolean }>("/v1/users/me/profiles/member-iris")).json.data.deleted, false);

    // First meeting with different content never overwrites either side.
    const three = computer(directory, "three");
    three.list.push({ id: "member-iris", revision: 1, profile: profile("Iris", { role: "Designer" }) });
    const first = await three.cloud.sync();
    assert.equal(first.conflicts.length, 1);
    assert.equal(three.list[0].profile.role, "Designer");
    assert.equal((await call<{ content: { role: string } }>("/v1/users/me/profiles/member-iris")).json.data.content.role, "QA lead");

    // The account must be the Squad's owner.
    two.identity = "identity-bob";
    assert.match((await two.cloud.sync()).error, /different Autohand account/);
    two.identity = "";
    assert.match((await two.cloud.sync()).error, /Sign in/);
  } finally { await one.cloud.close(); await two.cloud.close(); await rm(directory, { recursive: true, force: true }); }
});

test("a team-owned Squad keeps profiles off until turned on, then uses the team's namespace", async () => {
  const directory = await mkdtemp(join(tmpdir(), "squad-profile-team-"));
  const team = computer(directory, "team", { kind: "team" as const, id: "team-shared", issuer: "https://api.autohand.ai", actorId: "identity_alice" } as never);
  try {
    team.list.push({ id: "member-ada", revision: 1, profile: profile("Ada") });
    assert.equal((await team.cloud.sync()).enabled, false); assert.equal(team.calls, 0);
    assert.equal((await team.cloud.setEnabled(true)).error, "");
    assert.equal((await call<{ content: { name: string } }>("/v1/teams/team-shared/profiles/member-ada", "GET", undefined, alice, "identity-alice")).json.data.content.name, "Ada");
    assert.equal((await call("/v1/users/me/profiles/member-ada")).status, 404);
  } finally { await team.cloud.close(); await rm(directory, { recursive: true, force: true }); }
});
