#!/usr/bin/env node
// A member changes its own avatar through the team MCP server (ADR-0243):
// squad_avatars lists and searches the 300 birds; squad_set_avatar saves a
// cast bird on the member's bridge copy, bumps its profile revision, and
// returns the `profile` receipt the browser applies like a rename. Anything
// that is not a cast bird is refused, and the tool cannot reach another
// member. Runs against a real channels store and team service in a temp dir.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createAgentChannelActions } from "../server/agent-channel-actions.mjs";
import { createChannelsStore } from "../server/channels-store.mjs";
import { createAvatarSetter } from "../server/team/member-avatar.mjs";
import { TEAM_TOOL_NAMES, createTeamService } from "../server/team/service.mjs";
import { BIRDS, birdFromAvatar } from "../src/lib/bird-cast.js";
import { memberProfileRevision, profileReceipts, unappliedProfileReceipts } from "../src/lib/member-shaping.js";
import { DEFAULT_BUILT_IN_TOOL_POLICIES, managedToolPolicies } from "../src/lib/permission-policy.js";

const root = resolve(new URL("..", import.meta.url).pathname);
const directory = await mkdtemp(join(tmpdir(), "squad-avatar-"));
try {
  const store = createChannelsStore({ filename: join(directory, "channels.json"), normalize: value => ({ revision: 0, agentChannelAccess: {}, ...value }) });
  const actions = createAgentChannelActions({ store, sanitizeId: value => value, availability: {} });
  const iris = { id: "asq_iris", name: "Iris", role: "Reviewer", avatar: "/avatars/birds/tui.webp" };
  const noah = { id: "asq_noah", name: "Noah", role: "Frontend", avatar: "/avatars/birds/kiwi.webp" };
  await actions.setAccess(iris.id, { agent: iris });
  await actions.setAccess(noah.id, { agent: noah });
  const members = async () => Object.entries((await store.read()).agentChannelAccess).map(([id, access]) => ({ ...access.agent, id, removed: Boolean(access.removed) }));
  const team = createTeamService({ stateDir: directory, rootDir: root, bridgeUrl: "http://127.0.0.1:9", members, setAvatar: createAvatarSetter({ actions: () => actions }) });
  const session = await team.openWork({ memberId: iris.id, runId: "run-avatar-1", workspace: root });
  const token = session.mcpServer.env.AUTOHAND_SQUAD_TEAM_TOKEN;
  let id = 0;
  const call = async (name, args) => team.dispatch(token, { jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } });

  // The tools exist, are allowed by default and reach the engine.
  assert.ok(TEAM_TOOL_NAMES.includes("squad_avatars") && TEAM_TOOL_NAMES.includes("squad_set_avatar"));
  const listed = (await team.dispatch(token, { jsonrpc: "2.0", id: ++id, method: "tools/list" })).tools.map(tool => tool.name);
  assert.ok(listed.includes("squad_set_avatar"), "tools/list offers squad_set_avatar");
  assert.equal(DEFAULT_BUILT_IN_TOOL_POLICIES.squad_avatars, "allow");
  assert.equal(DEFAULT_BUILT_IN_TOOL_POLICIES.squad_set_avatar, "allow");
  assert.deepEqual(managedToolPolicies({}).find(([kind]) => kind === "mcp__autohand-squad__squad_set_avatar"), ["mcp__autohand-squad__squad_set_avatar", "allow"]);
  assert.equal(managedToolPolicies({ squad_set_avatar: "block" }).find(([kind]) => kind.endsWith("squad_set_avatar"))[1], "block", "a person can block it");

  // Listing: paged, searchable, every id a cast bird.
  const first = (await call("squad_avatars", {})).structuredContent;
  assert.equal(first.castSize, 300);
  assert.equal(first.total, 300);
  assert.equal(first.birds.length, 40);
  assert.equal(first.pages, 8);
  const last = (await call("squad_avatars", { page: 8 })).structuredContent;
  assert.equal(last.birds.length, 300 - 7 * 40);
  const owls = (await call("squad_avatars", { query: "owl" })).structuredContent;
  assert.ok(owls.birds.some(bird => bird.id === "barnowl") && owls.birds.every(bird => BIRDS.some(cast => cast.id === bird.id)));
  const kingfishers = (await call("squad_avatars", { query: "kingfisher" })).structuredContent.birds.map(bird => bird.id);
  assert.ok(kingfishers.includes("kotare"), "English names find Māori labels");

  // Setting: a cast bird, saved with a revision and a profile receipt.
  const before = memberProfileRevision((await store.read()).agentChannelAccess[iris.id].agent);
  const result = await call("squad_set_avatar", { bird: "Kea" });
  assert.ok(!result.isError, result.content?.[0]?.text);
  assert.equal(result.structuredContent.bird, "kea");
  const saved = (await store.read()).agentChannelAccess[iris.id].agent;
  assert.equal(saved.avatar, "/avatars/birds/kea.webp");
  assert.equal(memberProfileRevision(saved), before + 1, "the change bumps the profile revision");
  assert.equal(saved.name, "Iris", "nothing else about the member changed");
  const receipts = team.takeReceipts("run-avatar-1");
  assert.equal(receipts.length, 1);
  const [receipt] = receipts;
  assert.deepEqual(receipt.patch, { avatar: "/avatars/birds/kea.webp" });
  assert.equal(receipt.actorId, iris.id);
  assert.equal(receipt.profileRevision, before + 1);
  assert.equal(receipt.message, "Iris is now the Kea.");
  // The browser applies it as it applies a rename: from the stream's
  // channelActions, or later from /api/runs when it was not watching.
  assert.equal(profileReceipts([receipt]).length, 1, "the browser treats it as an applied profile receipt");
  assert.deepEqual(unappliedProfileReceipts([{ agentId: iris.id, finishedAt: "2026-11-17T10:00:00Z", channelActions: [receipt] }]).map(entry => entry.agentId), [iris.id]);

  // Refusals: not a bird, a URL, an image, or another member's avatar.
  for (const bird of ["dodo", "/avatars/birds/kea.webp", "https://example.com/x.png", "data:image/png;base64,AAAA", "../kea"]) {
    const refused = await call("squad_set_avatar", { bird });
    assert.equal(refused.isError, true, `${bird} must be refused`);
  }
  assert.equal((await call("squad_set_avatar", { bird: "kea", member: noah.id })).isError, true, "no field reaches another member");
  assert.equal((await store.read()).agentChannelAccess[noah.id].agent.avatar, "/avatars/birds/kiwi.webp", "Noah is untouched");
  assert.equal((await store.read()).agentChannelAccess[iris.id].agent.avatar, "/avatars/birds/kea.webp", "refused calls changed nothing");
  // The bridge refuses the avatar path for anything but a lone cast bird.
  await assert.rejects(actions.setAccess(iris.id, { agent: iris, profilePatch: { avatar: "https://example.com/x.png" }, avatarActor: "agent" }), /Squad bird/);
  await assert.rejects(actions.setAccess(iris.id, { agent: iris, profilePatch: { avatar: "/avatars/birds/kea.webp", name: "Mallory" }, avatarActor: "agent" }), /unsupported|Squad bird/);
  await assert.rejects(actions.setAccess(iris.id, { agent: iris, profilePatch: { avatar: "/avatars/birds/kea.webp" } }), /unsupported field/, "only the avatar tool may patch the avatar");
  // A removed member cannot come back through its avatar.
  await actions.setAccess(noah.id, { removed: true });
  await assert.rejects(createAvatarSetter({ actions: () => actions })(noah.id, "kea"), /no longer available/);
  assert.equal((await store.read()).agentChannelAccess[noah.id].removed, true);
  // Every cast bird is settable and round-trips through its URL.
  assert.ok(BIRDS.every(bird => birdFromAvatar(`/avatars/birds/${bird.id}.webp`) === bird.id));
  team.close();
  console.log(`check-member-avatar: ok (${BIRDS.length} birds, list + set + refusals)`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
