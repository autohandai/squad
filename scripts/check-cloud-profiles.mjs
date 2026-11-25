// Member profiles in the owner's Autohand account (ADR-0280).
// 1. The workerd contract in services/squad-api (the Worker's revisioned
//    store, two desktop computers merging through it, clashes, account
//    affinity, no traffic when off).
// 2. The real bridge (server.mjs, signed in to an isolated fixture owner)
//    against the real Worker in Miniflare: a member created here goes to the
//    account; edits made in the account (as another computer would) come back
//    through the bridge's own revision-checked member save and bird setter.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { startProfilesWorker } from "../services/squad-api/scripts/local-profiles-worker.mjs";
import { startBridge } from "./lib/reliability-browser.mjs";

const api = fileURLToPath(new URL("../services/squad-api/", import.meta.url));
const contract = spawnSync("npx", ["tsx", "--test", "test/profiles.test.ts"], { cwd: api, stdio: "inherit" });
if (contract.status !== 0) process.exit(contract.status || 1);

const freePort = () => new Promise(resolve => { const server = createServer(); server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
const apiPort = await freePort(), apiOrigin = `http://127.0.0.1:${apiPort}`;
const bridge = await startBridge({ prepare: async () => ({ AUTOHAND_SQUAD_API_URL: apiOrigin }) });
let worker;
try {
  const context = (await bridge.api("/api/ownership/context")).data;
  assert.equal(context.state, "ready", JSON.stringify(context));
  // The Worker trusts the same isolated identity the bridge signed in with.
  worker = await startProfilesWorker({ port: apiPort, issuer: context.owner.issuer, ownerId: context.owner.id });
  const session = (await (await fetch(`${apiOrigin}/v1/auth/exchange`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identityToken: "fixture-only-no-provider", deviceName: "Other computer" }) })).json()).data.token;
  const cloud = async (path, method = "GET", body, key) => (await fetch(`${apiOrigin}/v1/users/me/profiles${path}`, { method,
    headers: { authorization: `Bearer ${session}`, ...(body ? { "content-type": "application/json" } : {}), ...(key ? { "idempotency-key": key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })).json();
  const sync = async () => { const result = await bridge.api("/api/cloud/profiles/sync", "POST", {}, 30000); assert.equal(result.data?.error, "", JSON.stringify(result)); return result.data; };

  const created = await bridge.api("/api/control-plane/members", "POST", { request_id: "cloud-profiles-check", name: "Tui", role: "Release QA", description: "Checks releases", instructions: "Read the evidence first.", personality: "Calm" });
  assert.equal(created.success, true, JSON.stringify(created));
  const id = created.data.id;
  const status = await bridge.api("/api/cloud/profiles");
  assert.equal(status.data.available, true, JSON.stringify(status)); assert.equal(status.data.enabled, true, "a signed-in personal Squad keeps profiles in the account by default");
  await sync();
  const pushed = await cloud(`/${id}`);
  assert.equal(pushed.data?.content?.name, "Tui", JSON.stringify(pushed)); assert.equal(pushed.data.content.personality, "Calm");
  assert(!JSON.stringify(pushed.data.content).includes("/Users/"), "no paths leave the computer");

  // Another computer changes the role and the bird in the account.
  const changed = await cloud(`/${id}`, "PUT", { baseRevision: pushed.data.revision, content: { ...pushed.data.content, role: "Release lead", avatar: "kea" } }, "other-computer-1");
  assert.equal(changed.success, true, JSON.stringify(changed));
  const before = (await bridge.api(`/api/control-plane/members/${id}`)).data.revision;
  await sync();
  const after = (await bridge.api(`/api/control-plane/members/${id}`)).data;
  assert.equal(after.role, "Release lead"); assert(after.revision > before, "applied through the revision-checked save");
  const member = (await bridge.api("/api/agent-channels")).data?.agentChannelAccess?.[id]?.agent
    || Object.values((await bridge.api("/api/channels")).data?.agentChannelAccess || {}).find(access => access.agent?.id === id)?.agent;
  assert.match(String(member?.avatar || ""), /\/kea\.webp$/, `the account's bird is applied (${member?.avatar})`);

  // An edit here goes up on the next sync.
  assert.equal((await bridge.api(`/api/control-plane/members/${id}`, "PATCH", { description: "Owns the release checklist", expectedRevision: after.revision })).success, true);
  await sync();
  assert.equal((await cloud(`/${id}`)).data.content.description, "Owns the release checklist");

  // A member kept in the account from another computer can be added here.
  const elsewhere = { name: "Kākā", role: "Designer", description: "Draws the release notes", instructions: "", personality: "Playful", skills: [], avatar: "kea", voice: "" };
  assert.equal((await cloud("/member-from-laptop", "PUT", { baseRevision: 0, content: elsewhere }, "laptop-create")).success, true);
  assert.deepEqual((await sync()).cloudOnly.map(entry => entry.id), ["member-from-laptop"]);
  const added = await bridge.api("/api/cloud/profiles/add", "POST", { id: "member-from-laptop" }, 30000);
  assert.equal(added.data?.cloudOnly?.length, 0, JSON.stringify(added));
  const local = Object.values((await bridge.api("/api/channels")).data?.agentChannelAccess || {}).find(access => access.agent?.name === "Kākā" && !access.removed)?.agent;
  assert.equal(local?.role, "Designer"); assert.match(String(local?.avatar || ""), /\/kea\.webp$/);
  assert.equal((await cloud("/member-from-laptop")).data.revision, 1, "adding it here does not rewrite the account's copy");

  // The switch stops all traffic.
  assert.equal((await bridge.api("/api/cloud/profiles/enabled", "POST", { enabled: false })).data.enabled, false);
  console.log("Cloud profile checks passed: workerd contract, and the real bridge pushes, applies account edits (role, bird) through its revision-checked save, sends local edits and stops when off.");
} catch (error) { console.error(bridge.logs.slice(-4000)); throw error; }
finally { await bridge.close(); await worker?.dispose(); }
