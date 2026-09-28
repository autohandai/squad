#!/usr/bin/env node
// A member's tool permissions survive the bridge.
//
// Two faults shipped together and neither had a test.
//
// 1. `/api/chat/warm` posts only an agent id, and `ensureAgentRuntime` used
//    that empty agent to rewrite the member's config.json permissions with
//    empty allow, ask and block lists. Warming fires once per member every
//    time a chat opens, so a tool the person moved from blocked to ask went
//    back to blocked "the moment it tries to use it", which is how a user
//    described it.
// 2. The autonomy ladder blocked every tool and never granted the skills
//    group, so `skill` was blocked at all four levels and no member could use
//    a skill it had.
//
// This drives the real bridge, so it holds however the code is arranged.
//
// See docs/adrs/ADR-0041-permissions-survive-the-bridge.md.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 19700 + Math.floor(Math.random() * 200);
const base = `http://127.0.0.1:${port}`;
const home = await mkdtemp(join(tmpdir(), "squad-perm-"));
const stateDir = join(home, "state");
const workspace = root;

const bridge = spawn(process.execPath, ["server.mjs", "--host", "127.0.0.1", "--port", String(port)], {
  cwd: root,
  env: { ...process.env, AUTOHAND_SQUAD_HOME: join(home, "squad"), AUTOHAND_SQUAD_APP_STATE_DIR: stateDir },
  stdio: "ignore",
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const post = (path, body) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const configFor = async (id) => JSON.parse(await readFile(join(stateDir, "agents", id, "config.json"), "utf8"));

try {
  let up = false;
  for (let attempt = 0; attempt < 60 && !up; attempt += 1) {
    await sleep(250);
    up = await fetch(`${base}/api/runtime`).then((r) => r.ok).catch(() => false);
  }
  assert.ok(up, "the bridge started");

  // --- a member whose owner asked for one tool to prompt -------------------

  const id = "permcheck";
  const agent = {
    id,
    name: "Perm Check",
    workspace,
    skills: [],
    permissions: {
      permissionMode: "interactive",
      builtInToolPolicyEnabled: true,
      builtInPolicies: { skill: "ask", shell: "block", plan: "allow" },
    },
  };

  const provisioned = await post("/api/agents/provision", { agentId: id, agent, workspace });
  assert.ok(provisioned?.success, `provisioning worked: ${provisioned?.error || ""}`);

  const before = await configFor(id);
  const rulesFor = (config, tool) => (config.permissions?.rules || []).find((rule) => rule.tool === tool);
  const listHas = (config, key, tool) => (config.permissions?.[key] || []).some((entry) => entry.kind === tool);

  assert.ok(rulesFor(before, "skill"), "the tool the person set to ask is written as a prompt rule");
  assert.equal(rulesFor(before, "skill").action, "prompt");
  assert.ok(listHas(before, "excludedTools", "shell"), "a blocked tool is written as excluded");
  assert.ok(listHas(before, "allowPatterns", "plan"), "an allowed tool is written as allowed");

  // --- the warm call must not touch any of it -----------------------------

  const warmed = await post("/api/chat/warm", { agentId: id, workspace });
  assert.ok(warmed?.success !== false, "warming answered");
  await sleep(600);

  const after = await configFor(id);
  assert.deepEqual(
    after.permissions,
    before.permissions,
    "a request that carries no agent must not rewrite that member's permissions"
  );
  assert.ok(rulesFor(after, "skill"), "the ask rule is still there after warming");
  assert.ok(listHas(after, "excludedTools", "shell"), "the block is still there after warming");

  // Any agent-less call, not just warming: the guard is about the payload.
  await post("/api/chat/warm", { agentId: id, workspace, agent: null });
  await sleep(400);
  assert.deepEqual((await configFor(id)).permissions, before.permissions, "a null agent is also no agent");

  // --- and describing the member still updates it --------------------------

  const changed = { ...agent, permissions: { ...agent.permissions, builtInPolicies: { skill: "allow", shell: "block", plan: "allow" } } };
  await post("/api/agents/provision", { agentId: id, agent: changed, workspace });
  const updated = await configFor(id);
  assert.ok(listHas(updated, "allowPatterns", "skill"), "a call that does describe the member still updates it");

  // --- the ladder has to grant the skill tools at all ----------------------
  //
  // The ladder lives in src/App.jsx, which cannot be imported from Node, so
  // this reads the source. It is a weaker test than the ones above and it
  // exists because the failure it guards was silent: every tool started
  // blocked, the skills group was never granted, and no member could use a
  // skill it had. A rename will trip this; that is the cheaper mistake.

  const app = await readFile(join(root, "src", "App.jsx"), "utf8");
  const ladder = app.slice(app.indexOf("function builtInPoliciesForAutonomyLadder"));
  const body = ladder.slice(0, ladder.indexOf("\nfunction "));
  assert.ok(body.includes('"skill"'), "the ladder grants the skill tool at some level");
  assert.ok(body.includes('"find_agent_skills"'), "and looking up which skills exist");
  assert.ok(
    body.includes('applyGroupDefaults("profile-memory")'),
    "the rest of the skills and memory group is granted at its own declared modes, not blocked outright"
  );
  const groups = app.slice(app.indexOf("const BUILT_IN_TOOL_POLICY_GROUPS"));
  assert.ok(groups.slice(0, groups.indexOf("\n];")).includes('["skill"'), "skill is still a known tool");

  console.log("check-permissions: ok");
} finally {
  bridge.kill("SIGKILL");
  await rm(home, { recursive: true, force: true }).catch(() => {});
}
